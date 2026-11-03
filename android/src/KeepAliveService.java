package PKG;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/** Keeps the radio process awake while the phone is locked. */
public class KeepAliveService extends Service {
  static final String CHANNEL = "keepalive";
  PowerManager.WakeLock wakeLock;

  @Override public void onCreate() {
    super.onCreate();
    NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Always on", NotificationManager.IMPORTANCE_LOW));
    }
    Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent pending = PendingIntent.getActivity(this, 0, open, Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    Notification.Builder builder = Build.VERSION.SDK_INT >= 26
      ? new Notification.Builder(this, CHANNEL)
      : new Notification.Builder(this);
    Notification notification = builder
      .setContentTitle(getApplicationInfo().loadLabel(getPackageManager()))
      .setContentText("Radio is running")
      .setSmallIcon(getApplicationInfo().icon)
      .setOngoing(true)
      .setContentIntent(pending)
      .build();
    if (Build.VERSION.SDK_INT >= 29) {
      int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
      if (Build.VERSION.SDK_INT < 34 || checkSelfPermission("android.permission.RECORD_AUDIO") == 0) {
        type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
      }
      try {
        startForeground(1, notification, type);
      } catch (Exception error) {
        startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
      }
    } else {
      startForeground(1, notification);
    }
    wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":keepalive");
    wakeLock.setReferenceCounted(false);
    wakeLock.acquire();
  }

  @Override public int onStartCommand(Intent intent, int flags, int id) {
    return START_STICKY;
  }

  @Override public void onDestroy() {
    try {
      if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    } catch (Exception ignored) {}
    wakeLock = null;
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
    else stopForeground(true);
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) {
    return null;
  }
}
