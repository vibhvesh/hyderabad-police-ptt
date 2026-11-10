#include "config_store.h"
#include "pins.h"
#include <Preferences.h>

static const char *NS = "sanket";

HandsetConfig configLoad() {
  Preferences prefs;
  prefs.begin(NS, true);
  HandsetConfig cfg;
  cfg.ssid = prefs.getString("ssid", "");
  cfg.password = prefs.getString("pass", "");
  cfg.server = prefs.getString("url", DEFAULT_SERVER);
  cfg.lineId = prefs.getString("line", "");
  cfg.deviceId = prefs.getString("devid", "");
  cfg.token = prefs.getString("token", "");
  cfg.name = prefs.getString("name", "Handset");
  cfg.tlsInsecure = prefs.getBool("insecure", false);
  cfg.deepSleepIdle = prefs.getBool("deepsleep", false);
  prefs.end();
  cfg.valid = cfg.ssid.length() > 0 && cfg.lineId.length() > 0 && cfg.deviceId.length() > 0 && cfg.token.length() > 0 && cfg.server.length() > 0;
  return cfg;
}

void configSave(const HandsetConfig &cfg) {
  Preferences prefs;
  prefs.begin(NS, false);
  prefs.putString("ssid", cfg.ssid);
  prefs.putString("pass", cfg.password);
  prefs.putString("url", cfg.server.length() ? cfg.server : DEFAULT_SERVER);
  prefs.putString("line", cfg.lineId);
  prefs.putString("devid", cfg.deviceId);
  prefs.putString("token", cfg.token);
  prefs.putString("name", cfg.name.length() ? cfg.name : "Handset");
  prefs.putBool("insecure", cfg.tlsInsecure);
  prefs.putBool("deepsleep", cfg.deepSleepIdle);
  prefs.end();
}

void configClear() {
  Preferences prefs;
  prefs.begin(NS, false);
  prefs.clear();
  prefs.end();
}
