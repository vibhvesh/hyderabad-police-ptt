package PKG;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  static final String URL = "APPURL";

  @Override protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, 1);
    WebView web = new WebView(this);
    setContentView(web);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(PermissionRequest request) { request.grant(request.getResources()); }
    });
    if (saved != null) web.restoreState(saved);
    else web.loadUrl(URL);
  }
}
