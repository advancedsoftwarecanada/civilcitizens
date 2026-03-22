package ca.civilcitizens;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	public static final String CALL_NOTIFICATION_CHANNEL_ID = "incoming_calls";
	public static final String DRIVE_RIDE_UPDATE_NOTIFICATION_CHANNEL_ID = "drive_ride_updates";

	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		ensureNotificationChannels();
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
}
