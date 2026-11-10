// Listen-only player for the ESP8266 NodeMCU v2/v3.
// The chip can drive a MAX98357A out of its I2S block. It cannot read an I2S microphone,
// and it does not have room for a second full-rate audio path. This build only plays.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <core_esp8266_i2s.h>
#include "ca_store.h"

static const uint32_t MAGIC = 0xA15E0002;
static const int RING = 1600;
static const int START_AT = 800;

struct Saved {
  uint32_t magic;
  char ssid[33];
  char pass[65];
  char url[96];
  char line[24];
  char id[16];
  char token[48];
  char name[24];
  uint8_t insecure;
};

static Saved cfg;
static WebSocketsClient socket;
static int16_t ring[RING];
static int ringWrite = 0;
static int ringCount = 0;
static bool playing = false;
static int gain = 256;
static bool online = false;
static char lineId[24] = "";
static unsigned long nextTry = 0;
static unsigned long backoff = 1000;
static unsigned long lastPresence = 0;

static int16_t pull() {
  if (ringCount <= 0) return 0;
  int at = ringWrite - ringCount;
  if (at < 0) at += RING;
  ringCount--;
  return ring[at];
}

static void push(int16_t sample) {
  if (ringCount >= RING) return;
  ring[ringWrite] = sample;
  ringWrite = (ringWrite + 1) % RING;
  ringCount++;
  if (ringCount >= START_AT) playing = true;
}

static int b64(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

static void playPacket(const uint8_t *raw, size_t len) {
  if (len < 6) return;
  size_t n = raw[0] & 0x7f;
  bool versioned = (raw[0] & 0x80) != 0;
  size_t start = 1 + n + (versioned ? 4 : 0);
  if (n < 1 || len < start + 2) return;
  for (size_t i = start; i + 1 < len; i += 2) {
    int16_t sample = (int16_t)(raw[i] | (raw[i + 1] << 8));
    int scaled = ((int)sample * gain) / 256;
    if (scaled > 32767) scaled = 32767;
    if (scaled < -32768) scaled = -32768;
    push((int16_t)scaled);
  }
}

static void takeAudio(const char *b64text) {
  static uint8_t raw[1400];
  size_t o = 0;
  int val[4];
  int n = 0;
  for (size_t i = 0; b64text[i] && o + 3 < sizeof(raw); i++) {
    if (b64text[i] == '=') continue;
    int v = b64(b64text[i]);
    if (v < 0) continue;
    val[n++] = v;
    if (n == 4) {
      raw[o++] = (uint8_t)((val[0] << 2) | (val[1] >> 4));
      raw[o++] = (uint8_t)((val[1] << 4) | (val[2] >> 2));
      raw[o++] = (uint8_t)((val[2] << 6) | val[3]);
      n = 0;
    }
  }
  playPacket(raw, o);
}

static void onEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    online = true;
    backoff = 1000;
    JsonDocument doc;
    doc["op"] = "hello";
    doc["device"]["id"] = cfg.id;
    doc["device"]["token"] = cfg.token;
    doc["device"]["listenOnly"] = true;
    doc["device"]["rate"] = 8000;
    String body;
    serializeJson(doc, body);
    socket.sendTXT(body);
    return;
  }
  if (type == WStype_DISCONNECTED) {
    online = false;
    nextTry = millis() + backoff;
    if (backoff < 30000) backoff *= 2;
    return;
  }
  if (type != WStype_TEXT) return;
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  const char *op = doc["op"] | "";
  if (strcmp(op, "ready") == 0) {
    strlcpy(lineId, doc["device"]["lineId"] | "", sizeof(lineId));
    Serial.printf("Listen-only on %s at %d Hz\n", lineId, (int)(doc["device"]["rate"] | 8000));
    return;
  }
  if (strcmp(op, "err") == 0) {
    Serial.printf("Relay: %s\n", (const char *)(doc["message"] | "error"));
    return;
  }
  if (strcmp(op, "msg") != 0) return;
  const char *topic = doc["topic"] | "";
  if (!strstr(topic, "/audio")) return;
  if (strcmp(doc["encoding"] | "", "base64") != 0) return;
  takeAudio(doc["payload"] | "");
}

static void connectNow() {
  const char *start = cfg.url;
  bool secure = strncmp(start, "wss://", 6) == 0;
  if (secure) start += 6;
  else if (strncmp(start, "ws://", 5) == 0) start += 5;
  else return;
  char host[64];
  const char *slash = strchr(start, '/');
  size_t n = slash ? (size_t)(slash - start) : strlen(start);
  if (n >= sizeof(host)) return;
  memcpy(host, start, n);
  host[n] = 0;
  const char *path = slash ? slash : "/ws";
  uint16_t port = secure ? 443 : 80;
  socket.onEvent(onEvent);
  socket.setReconnectInterval(0);
  if (secure && !cfg.insecure) socket.beginSslWithCA(host, port, path, ISRG_ROOT_X1);
  else if (secure) socket.beginSSL(host, port, path);
  else socket.begin(host, port, path);
}

static void loadCfg() {
  EEPROM.begin(sizeof(Saved));
  EEPROM.get(0, cfg);
  if (cfg.magic != MAGIC) {
    memset(&cfg, 0, sizeof(cfg));
    strlcpy(cfg.url, "wss://ptt.bowlinger.net/ws", sizeof(cfg.url));
    strlcpy(cfg.name, "Listener", sizeof(cfg.name));
  }
}

static void saveCfg() {
  cfg.magic = MAGIC;
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

static bool validCfg() {
  return cfg.ssid[0] && cfg.line[0] && cfg.id[0] && cfg.token[0] && cfg.url[0];
}

static void portal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("Sanket-Listen");
  DNSServer dns;
  dns.start(53, "*", WiFi.softAPIP());
  ESP8266WebServer server(80);
  server.on("/", [&]() {
    server.send(200, "text/html",
                "<form method=post action=/save>Wi-Fi <input name=ssid><br>Password <input name=pass type=password><br>"
                "Server <input name=url value='wss://ptt.bowlinger.net/ws'><br>Line <input name=line><br>"
                "Device id <input name=id><br>Token <input name=token type=password><br>Name <input name=name value=Listener><br>"
                "<button>Save</button></form>");
  });
  server.on("/save", HTTP_POST, [&]() {
    strlcpy(cfg.ssid, server.arg("ssid").c_str(), sizeof(cfg.ssid));
    strlcpy(cfg.pass, server.arg("pass").c_str(), sizeof(cfg.pass));
    strlcpy(cfg.url, server.arg("url").c_str(), sizeof(cfg.url));
    strlcpy(cfg.line, server.arg("line").c_str(), sizeof(cfg.line));
    strlcpy(cfg.id, server.arg("id").c_str(), sizeof(cfg.id));
    strlcpy(cfg.token, server.arg("token").c_str(), sizeof(cfg.token));
    strlcpy(cfg.name, server.arg("name").c_str(), sizeof(cfg.name));
    saveCfg();
    server.send(200, "text/plain", "Saved. Restarting.");
    delay(300);
    ESP.restart();
  });
  server.onNotFound([&]() {
    server.sendHeader("Location", "/");
    server.send(302, "text/plain", "");
  });
  server.begin();
  Serial.printf("Setup AP Sanket-Listen at %s\n", WiFi.softAPIP().toString().c_str());
  for (;;) {
    dns.processNextRequest();
    server.handleClient();
    yield();
  }
}

static void presence() {
  if (!online || !lineId[0]) return;
  int raw = analogRead(A0);
  char json[200];
  if (raw > 250 && raw < 1020) {
    float voltage = raw / 1023.f * 4.2f;
    int percent = (int)((voltage - 3.3f) / 0.9f * 100.f);
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    snprintf(json, sizeof(json),
             "{\"id\":\"%s\",\"name\":\"%s\",\"ts\":%lu,\"kind\":\"handset\",\"listenOnly\":true,\"rssi\":%d,\"battery\":%d,\"voltage\":%.2f}",
             cfg.id, cfg.name, millis(), WiFi.RSSI(), percent, voltage);
  } else {
    snprintf(json, sizeof(json),
             "{\"id\":\"%s\",\"name\":\"%s\",\"ts\":%lu,\"kind\":\"handset\",\"listenOnly\":true,\"rssi\":%d}",
             cfg.id, cfg.name, millis(), WiFi.RSSI());
  }
  char topic[80];
  snprintf(topic, sizeof(topic), "sanket-ptt/v1/%s/presence/%s", lineId, cfg.id);
  JsonDocument doc;
  doc["op"] = "pub";
  doc["topic"] = topic;
  doc["retain"] = true;
  doc["encoding"] = "utf8";
  doc["payload"] = json;
  String body;
  serializeJson(doc, body);
  socket.sendTXT(body);
}

static void volume() {
  static bool downWas = false;
  static bool upWas = false;
  bool down = digitalRead(12) == LOW;
  bool up = digitalRead(14) == LOW;
  if (down && !downWas && gain > 64) gain -= 64;
  if (up && !upWas && gain < 512) gain += 64;
  downWas = down;
  upWas = up;
}

void setup() {
  Serial.begin(115200);
  delay(100);
  pinMode(16, OUTPUT);
  digitalWrite(16, HIGH);
  pinMode(12, INPUT_PULLUP);
  pinMode(14, INPUT_PULLUP);
  pinMode(15, INPUT);
  loadCfg();
  unsigned long start = millis();
  if (digitalRead(14) == LOW) {
    while (millis() - start < 3000 && digitalRead(14) == LOW) delay(20);
    if (millis() - start >= 3000) portal();
  }
  if (!validCfg()) portal();
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid, cfg.pass);
  Serial.printf("Joining %s\n", cfg.ssid);
  i2s_begin();
  i2s_set_rate(8000);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(16, (millis() / 200) % 2 ? LOW : HIGH);
    delay(20);
    return;
  }
  static bool started = false;
  if (!started) {
    nextTry = millis();
    started = true;
  }
  if (!online && (long)(millis() - nextTry) >= 0) {
    nextTry = millis() + backoff;
    connectNow();
  }
  socket.loop();
  volume();
  if (playing) {
    if (ringCount == 0) playing = false;
    else if (!i2s_is_full()) {
      int16_t sample = pull();
      i2s_write_lr(sample, sample);
    }
  }
  if (online && millis() - lastPresence > 5000) {
    lastPresence = millis();
    presence();
    digitalWrite(16, LOW);
  }
  yield();
}
