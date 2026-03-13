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

	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		ensureNotificationChannels();
	}

	private void ensureNotificationChannels() {
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

		NotificationManager manager = getSystemService(NotificationManager.class);
		if (manager == null) return;

		NotificationChannel callChannel = new NotificationChannel(
			CALL_NOTIFICATION_CHANNEL_ID,
			"Incoming calls",
			NotificationManager.IMPORTANCE_HIGH
		);
		callChannel.setDescription("Alerts for incoming audio and video calls.");
		callChannel.enableVibration(true);

		AudioAttributes audioAttributes = new AudioAttributes.Builder()
			.setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
			.setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
			.build();
		Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.ringtone);
		callChannel.setSound(soundUri, audioAttributes);

		manager.createNotificationChannel(callChannel);
	}
}
