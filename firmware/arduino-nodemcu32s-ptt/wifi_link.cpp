#include "wifi_link.h"
#include "config.h"
#include <WiFi.h>
#include <time.h>

static unsigned long nextRetry = 0;

void wifiBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Wi-Fi connecting to %s\n", WIFI_SSID);
  nextRetry = millis() + 8000;
}

void wifiLoop() {
  if (WiFi.status() == WL_CONNECTED) {
    static bool told = false;
    if (!told) {
      told = true;
      Serial.printf("Wi-Fi connected, IP %s\n", WiFi.localIP().toString().c_str());
      configTime(0, 0, "pool.ntp.org", "time.google.com");
    }
    return;
  }
  if ((long)(millis() - nextRetry) < 0) return;
  nextRetry = millis() + 8000;
  Serial.println("Wi-Fi lost, trying again");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool wifiUp() {
  return WiFi.status() == WL_CONNECTED;
}

bool clockReady() {
  time_t now = time(nullptr);
  return now > 1700000000;
}
