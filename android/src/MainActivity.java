package PKG;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  static final String URL = "APPURL";
  WebView web;
  ValueCallback<Uri[]> fileCallback;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (Build.VERSION.SDK_INT >= 23) {
      requestPermissions(new String[] {
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.POST_NOTIFICATIONS"
      }, 1);
    }
    startKeepAlive();
    web = new WebView(this);
    setContentView(web);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setGeolocationEnabled(true);
    web.setWebViewClient(new AppClient(this));
    web.setWebChromeClient(new AppChrome(this));
    web.setDownloadListener(new AppDownloads(this));
    if (state != null) web.restoreState(state);
    else web.loadUrl(URL);
  }

  void startKeepAlive() {
    try {
      Intent intent = new Intent(this, KeepAliveService.class);
      if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
      else startService(intent);
    } catch (Exception ignored) {}
  }

  @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
    stopService(new Intent(this, KeepAliveService.class));
    startKeepAlive();
  }

  @Override protected void onDestroy() {
    if (isFinishing()) stopService(new Intent(this, KeepAliveService.class));
    super.onDestroy();
  }

  @Override protected void onActivityResult(int request, int result, Intent data) {
    if (request == 2 && fileCallback != null) {
      fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
      fileCallback = null;
    }
  }

  @Override protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    web.saveState(state);
  }

  @Override public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }
}

class AppClient extends WebViewClient {
  final MainActivity activity;
  AppClient(MainActivity activity) { this.activity = activity; }
  @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
    String target = request.getUrl().toString();
    if (target.startsWith("http")) return false;
    try { activity.startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) {}
    return true;
  }
}

class AppChrome extends WebChromeClient {
  final MainActivity activity;
  AppChrome(MainActivity activity) { this.activity = activity; }
  @Override public void onPermissionRequest(PermissionRequest request) {
    request.grant(request.getResources());
  }
  @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
    callback.invoke(origin, true, false);
  }
  @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
    if (activity.fileCallback != null) activity.fileCallback.onReceiveValue(null);
    activity.fileCallback = callback;
    try {
      activity.startActivityForResult(params.createIntent(), 2);
    } catch (Exception error) {
      activity.fileCallback = null;
      return false;
    }
    return true;
  }
}

class AppDownloads implements DownloadListener {
  final MainActivity activity;
  AppDownloads(MainActivity activity) { this.activity = activity; }
  @Override public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long length) {
    try {
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
      request.setMimeType(mimeType);
      request.addRequestHeader("User-Agent", userAgent);
      request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
      request.setDestinationInExternalPublicDir(
        Environment.DIRECTORY_DOWNLOADS,
        URLUtil.guessFileName(url, contentDisposition, mimeType)
      );
      ((DownloadManager) activity.getSystemService(Activity.DOWNLOAD_SERVICE)).enqueue(request);
    } catch (Exception ignored) {}
  }
}
