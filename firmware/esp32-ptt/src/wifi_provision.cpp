#include "wifi_provision.h"
#include "board.h"
#include "pins.h"
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

static const char *FORM = R"html(<!doctype html>
<html><head><meta name=viewport content="width=device-width,initial-scale=1">
<title>Sanket handset</title></head>
<body style="font-family:sans-serif;max-width:28rem;margin:1rem auto">
<h1>Sanket handset</h1>
<p>This page saves Wi-Fi and the line token on the handset. The token is not printed on the serial log.</p>
<form method=post action=/save>
<label>Wi-Fi name<br><input name=ssid required value="%SSID%"></label><br><br>
<label>Wi-Fi password<br><input name=pass type=password value=""></label><br><br>
<label>Server<br><input name=url required value="%URL%"></label><br><br>
<label>Line id<br><input name=line required value="%LINE%"></label><br><br>
<label>Device id<br><input name=devid required value="%DEVID%"></label><br><br>
<label>Device token<br><input name=token type=password required></label><br><br>
<label>Name<br><input name=name value="%NAME%"></label><br><br>
<label><input type=checkbox name=insecure %INSEC%> Skip certificate check</label><br>
<label><input type=checkbox name=deep %DEEP%> Deep sleep after 15 idle minutes (misses calls)</label><br><br>
<button type=submit>Save and restart</button>
</form></body></html>)html";

static String page(const HandsetConfig &seed) {
  String html = FORM;
  html.replace("%SSID%", seed.ssid);
  html.replace("%URL%", seed.server.length() ? seed.server : DEFAULT_SERVER);
  html.replace("%LINE%", seed.lineId);
  html.replace("%DEVID%", seed.deviceId);
  html.replace("%NAME%", seed.name.length() ? seed.name : "Handset");
  html.replace("%INSEC%", seed.tlsInsecure ? "checked" : "");
  html.replace("%DEEP%", seed.deepSleepIdle ? "checked" : "");
  return html;
}

bool provisionRequestedAtBoot() {
  const BoardProfile &board = boardProfile();
  pinMode(board.buttonPin, board.buttonPullup ? INPUT_PULLUP : INPUT);
  delay(30);
  auto held = [&]() {
    int level = digitalRead(board.buttonPin);
    return board.buttonActiveLow ? level == LOW : level == HIGH;
  };
  if (!held()) return false;
  unsigned long start = millis();
  while (millis() - start < 3000) {
    if (!held()) return false;
    delay(20);
  }
  return true;
}

void provisionBlock(const HandsetConfig &seed) {
  const char *ap = "Sanket-Setup";
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap);
  DNSServer dns;
  dns.start(53, "*", WiFi.softAPIP());
  WebServer server(80);
  server.on("/", [&]() { server.send(200, "text/html", page(seed)); });
  server.on("/generate_204", [&]() { server.sendHeader("Location", "/"); server.send(302, "text/plain", ""); });
  server.on("/hotspot-detect.html", [&]() { server.sendHeader("Location", "/"); server.send(302, "text/plain", ""); });
  server.on("/save", HTTP_POST, [&]() {
    HandsetConfig next = seed;
    next.ssid = server.arg("ssid");
    next.password = server.arg("pass");
    next.server = server.arg("url");
    next.lineId = server.arg("line");
    next.lineId.toLowerCase();
    next.deviceId = server.arg("devid");
    next.deviceId.trim();
    next.token = server.arg("token");
    next.name = server.arg("name");
    next.tlsInsecure = server.hasArg("insecure");
    next.deepSleepIdle = server.hasArg("deep");
    if (!next.ssid.length() || !next.lineId.length() || next.deviceId.length() < 2 || next.token.length() < 8 || !next.server.length()) {
      server.send(400, "text/plain", "Wi-Fi name, server, line, and token are required.");
      return;
    }
    configSave(next);
    server.send(200, "text/html", "<p>Saved. The handset is restarting. Join your Wi-Fi again.</p>");
    delay(400);
    ESP.restart();
  });
  server.onNotFound([&]() { server.sendHeader("Location", "/"); server.send(302, "text/plain", ""); });
  server.begin();
  Serial.printf("Setup AP %s at %s\n", ap, WiFi.softAPIP().toString().c_str());
  for (;;) {
    dns.processNextRequest();
    server.handleClient();
    delay(2);
  }
}
