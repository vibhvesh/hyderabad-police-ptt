#include "ws_client.h"
#include "ca_store.h"
#include "codec.h"
#include "pins.h"
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <time.h>

static WebSocketsClient socket;
static WsAudioFn onAudio = nullptr;
static WsJsonFn onJson = nullptr;
static WsReadyFn onReady = nullptr;
static WsStatusFn onStatus = nullptr;
static char urlCopy[160] = "";
static char host[80] = "";
static char path[64] = "/ws";
static uint16_t port = 443;
static bool secure = true;
static bool insecure = false;
static char deviceId[16] = "";
static char token[80] = "";
static char lineId[48] = "";
static bool online = false;
static bool ready = false;
static bool connecting = false;
static unsigned long connectStarted = 0;
static unsigned long nextTry = 0;
static unsigned long backoff = 1000;
static uint8_t binary[4096];

void wsOnAudio(WsAudioFn fn) { onAudio = fn; }
void wsOnJson(WsJsonFn fn) { onJson = fn; }
void wsOnReady(WsReadyFn fn) { onReady = fn; }
void wsOnStatus(WsStatusFn fn) { onStatus = fn; }
bool wsOnline() { return online && ready; }
const char *wsLine() { return lineId; }
int wsRssi() { return WiFi.RSSI(); }

bool wsTimeReady() {
  time_t now = time(nullptr);
  return now > 1700000000;
}

static void setOnline(bool up) {
  online = up;
  connecting = false;
  if (!up) ready = false;
  if (onStatus) onStatus(up && ready);
}

static bool parseUrl(const char *url) {
  secure = strncmp(url, "wss://", 6) == 0;
  const char *start = url;
  if (strncmp(url, "wss://", 6) == 0) start += 6;
  else if (strncmp(url, "ws://", 5) == 0) start += 5;
  else return false;
  const char *slash = strchr(start, '/');
  const char *colon = strchr(start, ':');
  if (colon && (!slash || colon < slash)) {
    size_t n = (size_t)(colon - start);
    if (n >= sizeof(host)) return false;
    memcpy(host, start, n);
    host[n] = 0;
    port = (uint16_t)atoi(colon + 1);
  } else {
    size_t n = slash ? (size_t)(slash - start) : strlen(start);
    if (n >= sizeof(host)) return false;
    memcpy(host, start, n);
    host[n] = 0;
    port = secure ? 443 : 80;
  }
  if (slash && strlen(slash) < sizeof(path)) strlcpy(path, slash, sizeof(path));
  else strlcpy(path, "/ws", sizeof(path));
  return host[0] != 0;
}

static void sendHello() {
  JsonDocument doc;
  doc["op"] = "hello";
  doc["device"]["id"] = deviceId;
  doc["device"]["token"] = token;
  String body;
  serializeJson(doc, body);
  socket.sendTXT(body);
}

static void handleText(const char *text, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, text, len)) return;
  const char *op = doc["op"] | "";
  if (strcmp(op, "ready") == 0) {
    strlcpy(lineId, doc["device"]["lineId"] | "", sizeof(lineId));
    ready = true;
    backoff = 1000;
    if (onReady) onReady(lineId, doc["device"]["name"] | "");
    if (onStatus) onStatus(true);
    return;
  }
  if (strcmp(op, "err") == 0) {
    Serial.printf("Relay: %s\n", (const char *)(doc["message"] | "error"));
    backoff = 30000;
    socket.disconnect();
    return;
  }
  if (strcmp(op, "msg") != 0) return;
  const char *topic = doc["topic"] | "";
  const char *encoding = doc["encoding"] | "";
  const char *payload = doc["payload"] | "";
  if (strcmp(encoding, "base64") == 0 && strstr(topic, "/audio")) {
    size_t n = base64Decode(payload, strlen(payload), binary, sizeof(binary));
    char id[41];
    static int16_t pcm[1024];
    size_t samples = 0;
    uint32_t seq = 0;
    bool hasSeq = false;
    if (n && decodeAudioFrame(binary, n, id, sizeof(id), pcm, 1024, &samples, &seq, &hasSeq) && onAudio) {
      onAudio(id, pcm, samples, seq, hasSeq);
    }
    return;
  }
  if (onJson) onJson(topic, payload);
}

static void onEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    setOnline(true);
    sendHello();
    return;
  }
  if (type == WStype_DISCONNECTED) {
    setOnline(false);
    nextTry = millis() + backoff;
    if (backoff < 30000) backoff *= 2;
    return;
  }
  if (type == WStype_TEXT) handleText((const char *)payload, length);
}

static void connectNow() {
  if (!host[0]) return;
  socket.onEvent(onEvent);
  socket.setReconnectInterval(0);
  if (secure && !insecure) socket.beginSslWithCA(host, port, path, ISRG_ROOT_X1);
  else if (secure) socket.beginSSL(host, port, path);
  else socket.begin(host, port, path);
}

void wsBegin(const char *serverUrl, const char *id, const char *deviceToken, bool tlsInsecure) {
  insecure = tlsInsecure;
  strlcpy(deviceId, id, sizeof(deviceId));
  strlcpy(token, deviceToken, sizeof(token));
  strlcpy(urlCopy, serverUrl, sizeof(urlCopy));
  if (!parseUrl(urlCopy)) Serial.println("Server URL must start with ws:// or wss://");
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  nextTry = millis();
  backoff = 1000;
}

void wsLoop() {
  socket.loop();
  if (connecting && millis() - connectStarted > 15000) {
    connecting = false;
    socket.disconnect();
    nextTry = millis() + backoff;
  }
  if (!online && !connecting && millis() >= nextTry) {
    connecting = true;
    connectStarted = millis();
    nextTry = millis() + backoff;
    connectNow();
  }
}

void wsPublish(const char *topic, const uint8_t *payload, size_t len, bool binary, bool retain) {
  if (!wsOnline()) return;
  static char encoded[5600];
  if (binary) {
    if (!base64Encode(payload, len, encoded, sizeof(encoded))) return;
  } else {
    if (len >= sizeof(encoded)) return;
    memcpy(encoded, payload, len);
    encoded[len] = 0;
  }
  JsonDocument doc;
  doc["op"] = "pub";
  doc["topic"] = topic;
  doc["retain"] = retain;
  doc["encoding"] = binary ? "base64" : "utf8";
  doc["payload"] = encoded;
  String body;
  serializeJson(doc, body);
  socket.sendTXT(body);
}

void wsPublishText(const char *topic, const char *json, bool retain) {
  wsPublish(topic, (const uint8_t *)json, strlen(json), false, retain);
}
