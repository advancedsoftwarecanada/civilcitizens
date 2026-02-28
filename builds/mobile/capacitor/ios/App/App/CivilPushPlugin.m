#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CivilPushPlugin, "CivilPush",
           CAP_PLUGIN_METHOD(getDeviceToken, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(getRegistrationDebugInfo, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(requestPushPermissions, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(registerForRemoteNotifications, CAPPluginReturnPromise);
)
