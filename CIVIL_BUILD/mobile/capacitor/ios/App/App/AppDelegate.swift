import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
            if let error = error {
                print("push_permission_error", error)
            }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("push_device_token", token)
        Task {
            await self.registerDeviceToken(token)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("push_register_failed", error)
    }

    private func pushServiceUrl() -> URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "CIVILPushServiceURL") as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return URL(string: trimmed)
    }

    private func pushRegisterSecret() -> String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "CIVILPushRegisterSecret") as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func lastSentToken() -> String? {
        return UserDefaults.standard.string(forKey: "cc:lastPushDeviceToken")
    }

    private func setLastSentToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: "cc:lastPushDeviceToken")
    }

    private func registerDeviceToken(_ token: String) async {
        guard let baseUrl = pushServiceUrl() else { return }
        if lastSentToken() == token { return }

        let registerUrl = baseUrl.appendingPathComponent("register")
        var req = URLRequest(url: registerUrl)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        if let secret = pushRegisterSecret() {
            req.setValue(secret, forHTTPHeaderField: "x-register-secret")
        }

        let payload: [String: Any?] = [
            "token": token,
            "platform": "ios",
            "bundleId": Bundle.main.bundleIdentifier,
            "deviceId": UIDevice.current.identifierForVendor?.uuidString,
        ]

        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 }, options: [])
            let (_, res) = try await URLSession.shared.data(for: req)
            if let http = res as? HTTPURLResponse, http.statusCode >= 200 && http.statusCode < 300 {
                setLastSentToken(token)
                return
            }
            if let http = res as? HTTPURLResponse {
                print("push_register_http_status", http.statusCode)
            }
        } catch {
            print("push_register_network_error", error)
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
