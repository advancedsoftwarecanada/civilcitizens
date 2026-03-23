package ca.civilcitizens;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HomeLauncher")
public class HomeLauncherPlugin extends Plugin {
    @PluginMethod
    public void setAsLauncher(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("activity_unavailable");
            return;
        }

        try {
            PackageManager packageManager = activity.getPackageManager();
            packageManager.clearPackagePreferredActivities(activity.getPackageName());

            Intent intent = new Intent(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_HOME);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            activity.startActivity(intent);
            call.resolve();
        } catch (Exception exception) {
            call.reject("launcher_intent_failed", exception);
        }
    }

    @PluginMethod
    public void getLauncherStatus(PluginCall call) {
        Activity activity = getActivity();
        JSObject result = new JSObject();
        result.put("active", activity != null && isCivilLauncherActive(activity));
        call.resolve(result);
    }

    static boolean isCivilLauncherActive(Context context) {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_HOME);

        ResolveInfo resolveInfo = context.getPackageManager().resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
        if (resolveInfo == null || resolveInfo.activityInfo == null) return false;

        return context.getPackageName().equals(resolveInfo.activityInfo.packageName);
    }
}