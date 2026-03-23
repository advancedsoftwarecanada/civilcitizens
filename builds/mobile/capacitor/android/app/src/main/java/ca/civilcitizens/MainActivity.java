package ca.civilcitizens;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	public static final String CALL_NOTIFICATION_CHANNEL_ID = "incoming_calls";
	public static final String DRIVE_RIDE_UPDATE_NOTIFICATION_CHANNEL_ID = "drive_ride_updates";
	private final View.OnSystemUiVisibilityChangeListener legacySystemUiVisibilityListener = visibility -> {
		if (shouldUseLauncherImmersiveMode()) {
			applyLauncherImmersiveMode();
		}
	};

	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(HomeLauncherPlugin.class);
		super.onCreate(savedInstanceState);
		ensureNotificationChannels();
		configureSystemUiHandling();
		updateLauncherWindowMode();
	}

	@Override
	public void onResume() {
		super.onResume();
		updateLauncherWindowMode();
	}

	@Override
	public void onWindowFocusChanged(boolean hasFocus) {
		super.onWindowFocusChanged(hasFocus);
		if (hasFocus) {
			updateLauncherWindowMode();
		}
	}

	private void ensureNotificationChannels() {
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

		NotificationManager manager = getSystemService(NotificationManager.class);
		if (manager == null) return;

		AudioAttributes audioAttributes = new AudioAttributes.Builder()
			.setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
			.setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
			.build();

		NotificationChannel callChannel = new NotificationChannel(
			CALL_NOTIFICATION_CHANNEL_ID,
			"Incoming calls",
			NotificationManager.IMPORTANCE_HIGH
		);
		callChannel.setDescription("Alerts for incoming audio and video calls.");
		callChannel.enableVibration(true);
		Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.ringtone);
		callChannel.setSound(soundUri, audioAttributes);

		NotificationChannel driveRideUpdateChannel = new NotificationChannel(
			DRIVE_RIDE_UPDATE_NOTIFICATION_CHANNEL_ID,
			"Drive ride updates",
			NotificationManager.IMPORTANCE_HIGH
		);
		driveRideUpdateChannel.setDescription("Alerts for rider-facing drive contract updates.");
		driveRideUpdateChannel.enableVibration(true);
		Uri driveRideUpdateSoundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.honk_honk);
		driveRideUpdateChannel.setSound(driveRideUpdateSoundUri, audioAttributes);

		manager.createNotificationChannel(callChannel);
		manager.createNotificationChannel(driveRideUpdateChannel);
	}

	private void configureSystemUiHandling() {
		Window window = getWindow();
		if (window == null) return;

		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
			View decorView = window.getDecorView();
			decorView.setOnSystemUiVisibilityChangeListener(legacySystemUiVisibilityListener);
		}
	}

	private void updateLauncherWindowMode() {
		if (shouldUseLauncherImmersiveMode()) {
			applyLauncherImmersiveMode();
			return;
		}

		clearLauncherImmersiveMode();
	}

	private boolean shouldUseLauncherImmersiveMode() {
		return HomeLauncherPlugin.isCivilLauncherActive(this);
	}

	private void applyLauncherImmersiveMode() {
		Window window = getWindow();
		if (window == null) return;

		window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
			WindowInsetsController controller = window.getInsetsController();
			if (controller == null) return;

			controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
			controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
			return;
		}

		View decorView = window.getDecorView();
		decorView.setSystemUiVisibility(
			View.SYSTEM_UI_FLAG_LAYOUT_STABLE
				| View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
				| View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
				| View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
				| View.SYSTEM_UI_FLAG_FULLSCREEN
				| View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
		);
	}

	private void clearLauncherImmersiveMode() {
		Window window = getWindow();
		if (window == null) return;

		window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
			WindowInsetsController controller = window.getInsetsController();
			if (controller == null) return;

			controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
			controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_DEFAULT);
			return;
		}

		window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
	}
}
