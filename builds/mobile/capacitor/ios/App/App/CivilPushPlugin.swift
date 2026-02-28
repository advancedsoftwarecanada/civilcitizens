import Capacitor
import Foundation
import UIKit
import UserNotifications

@objc(CivilPushPlugin)
public class CivilPushPlugin: CAPPlugin {
    private let tokenKey = "cc:apnsDeviceToken"
    private let tokenAtKey = "cc:apnsDeviceTokenAt"
    private let tokenErrorKey = "cc:apnsDeviceTokenError"
    private let tokenErrorAtKey = "cc:apnsDeviceTokenErrorAt"
    private let lastNotificationUrlKey = "cc:lastNotificationUrl"
    private let lastNotificationUrlAtKey = "cc:lastNotificationUrlAt"

    @objc public func getDeviceToken(_ call: CAPPluginCall) {
        let token = UserDefaults.standard.string(forKey: tokenKey) ?? ""
        call.resolve(["value": token])
    }

    @objc public func getRegistrationDebugInfo(_ call: CAPPluginCall) {
        let token = UserDefaults.standard.string(forKey: tokenKey) ?? ""
        let tokenAt = UserDefaults.standard.object(forKey: tokenAtKey) as? Double
        let error = UserDefaults.standard.string(forKey: tokenErrorKey) ?? ""
        let errorAt = UserDefaults.standard.object(forKey: tokenErrorAtKey) as? Double
            let backendError = UserDefaults.standard.string(forKey: "cc:apnsBackendRegisterError") ?? ""
            let backendErrorAt = UserDefaults.standard.object(forKey: "cc:apnsBackendRegisterErrorAt") as? Double

        call.resolve([
            "token": token,
            "tokenLength": token.count,
            "tokenAt": tokenAt as Any,
            "error": error,
            "errorAt": errorAt as Any,
                "backendRegisterError": backendError,
                "backendRegisterErrorAt": backendErrorAt as Any,
        ])
    }

    @objc public func getLastNotificationTap(_ call: CAPPluginCall) {
        let url = UserDefaults.standard.string(forKey: lastNotificationUrlKey) ?? ""
        let urlAt = UserDefaults.standard.object(forKey: lastNotificationUrlAtKey) as? Double
        call.resolve([
            "url": url,
            "urlAt": urlAt as Any,
        ])
    }

    @objc public func clearLastNotificationTap(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: lastNotificationUrlKey)
        UserDefaults.standard.removeObject(forKey: lastNotificationUrlAtKey)
        call.resolve(["ok": true])
    }

    @objc public func requestPushPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            DispatchQueue.main.async {
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }

                var response: [String: Any] = ["receive": granted ? "granted" : "denied"]
                if let error {
                    response["error"] = error.localizedDescription
                }
                call.resolve(response)
            }
        }
    }

    @objc public func registerForRemoteNotifications(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
            call.resolve()
        }
    }
}
