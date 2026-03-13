import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    private let tokenKey = "cc:apnsDeviceToken"
    private let tokenAtKey = "cc:apnsDeviceTokenAt"
    private let tokenErrorKey = "cc:apnsDeviceTokenError"
    private let tokenErrorAtKey = "cc:apnsDeviceTokenErrorAt"
    private let backendErrorKey = "cc:apnsBackendRegisterError"
    private let backendErrorAtKey = "cc:apnsBackendRegisterErrorAt"
    private let lastNotificationUrlKey = "cc:lastNotificationUrl"
    private let lastNotificationUrlAtKey = "cc:lastNotificationUrlAt"

    private func persistNotificationTarget(from userInfo: [AnyHashable: Any]) {
        func persist(_ rawValue: String) {
            let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return }
            UserDefaults.standard.set(trimmed, forKey: lastNotificationUrlKey)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastNotificationUrlAtKey)
        }

        if let civil = userInfo["civil"] as? [AnyHashable: Any] {
            if let url = civil["url"] as? String {
                persist(url)
                return
            }
            if let threadId = civil["threadId"] as? String, !threadId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                persist("/messages?thread=\(threadId)")
                return
            }
        }

        if let url = userInfo["url"] as? String {
            persist(url)
            return
        }
        if let threadId = userInfo["threadId"] as? String, !threadId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            persist("/messages?thread=\(threadId)")
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        if let remoteNotification = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            persistNotificationTarget(from: remoteNotification)
        }
        return true
    }

    // Display alerts while app is foregrounded (useful during development/testing).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    // Handle tap on a push notification.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        defer { completionHandler() }

        let userInfo = response.notification.request.content.userInfo
        persistNotificationTarget(from: userInfo)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("push_device_token_len", token.count)
        UserDefaults.standard.set(token, forKey: tokenKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: tokenAtKey)
        UserDefaults.standard.removeObject(forKey: tokenErrorKey)
        UserDefaults.standard.removeObject(forKey: tokenErrorAtKey)
        UserDefaults.standard.removeObject(forKey: backendErrorKey)
        UserDefaults.standard.removeObject(forKey: backendErrorAtKey)
        Task {
            await self.registerDeviceTokenWithApiIfConfigured(token)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        let message = String(describing: error)
        print("push_register_failed", message)
        UserDefaults.standard.set(message, forKey: tokenErrorKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: tokenErrorAtKey)
    }

    private func pushRegisterSecret() -> String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "CIVILPushRegisterSecret") as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func apiBaseUrl() -> URL? {
        // Optional override (kept for backwards compatibility with existing builds / local setups).
        if let raw = Bundle.main.object(forInfoDictionaryKey: "CIVILPushServiceURL") as? String {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, let url = URL(string: trimmed) {
                return url
            }
        }

        // Default: read the bundled capacitor.config.json server.url.
        guard let url = Bundle.main.url(forResource: "capacitor.config", withExtension: "json") else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard
            let json = try? JSONSerialization.jsonObject(with: data, options: []),
            let dict = json as? [String: Any],
            let server = dict["server"] as? [String: Any],
            let rawUrl = server["url"] as? String
        else { return nil }

        let trimmed = rawUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return URL(string: trimmed)
    }

    private func lastSentToken() -> String? {
        return UserDefaults.standard.string(forKey: "cc:lastPushDeviceToken")
    }

    private func setLastSentToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: "cc:lastPushDeviceToken")
    }

    private func setBackendRegisterError(_ message: String?) {
        if let message, !message.isEmpty {
            UserDefaults.standard.set(message, forKey: backendErrorKey)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: backendErrorAtKey)
        } else {
            UserDefaults.standard.removeObject(forKey: backendErrorKey)
            UserDefaults.standard.removeObject(forKey: backendErrorAtKey)
        }
    }

    private func registerDeviceTokenWithApiIfConfigured(_ token: String) async {
        // Only attempt native registration when a register-secret is configured.
        // Otherwise, the web layer registers with the user's Bearer token.
        guard let secret = pushRegisterSecret() else { return }
        guard let baseUrl = apiBaseUrl() else { return }
        if lastSentToken() == token { return }

        let registerUrl = baseUrl.appendingPathComponent("api/mobile/push/register")
        var req = URLRequest(url: registerUrl)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(secret, forHTTPHeaderField: "x-register-secret")

        let payload: [String: Any?] = [
            "token": token,
            "platform": "ios",
            "bundleId": Bundle.main.bundleIdentifier,
            "deviceId": UIDevice.current.identifierForVendor?.uuidString,
        ]

        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 }, options: [])
            let (data, res) = try await URLSession.shared.data(for: req)
            guard let http = res as? HTTPURLResponse else {
                setBackendRegisterError("no_http_response")
                return
            }

            if http.statusCode >= 200 && http.statusCode < 300 {
                setBackendRegisterError(nil)
                setLastSentToken(token)
                return
            }

            let bodyText = String(data: data, encoding: .utf8) ?? ""
            setBackendRegisterError("http_\(http.statusCode):\(bodyText.prefix(200))")
        } catch {
            setBackendRegisterError("network_error:\(String(describing: error))")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
