#include "ptt_stream.h"
#include "audio_io.h"
#include "config.h"
#include "wifi_link.h"
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>

// ISRG Root X1. Public Let's Encrypt root used by ptt.bowlinger.net.
static const char ROOT_CA[] =
  "-----BEGIN CERTIFICATE-----\n"
  "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\n"
  "-----END CERTIFICATE-----\n";

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static WebSocketsClient socket;
static char lineId[48] = "";
static bool socketOpen = false;
static bool ready = false;
static bool connecting = false;
static unsigned long connectAt = 0;
static unsigned long nextTry = 0;
static unsigned long backoff = 1000;
static unsigned long lastPresence = 0;
static uint32_t seq = 0;
static bool holding = false;
static uint64_t claimTs = 0;
static uint64_t lastHb = 0;
static char holder[24] = "";

static int b64Val(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

static size_t b64Encode(const uint8_t *in, size_t len, char *out, size_t cap) {
  size_t need = ((len + 2) / 3) * 4 + 1;
  if (need > cap) return 0;
  size_t o = 0;
  for (size_t i = 0; i < len; i += 3) {
    uint32_t n = (uint32_t)in[i] << 16;
    if (i + 1 < len) n |= (uint32_t)in[i + 1] << 8;
    if (i + 2 < len) n |= in[i + 2];
    out[o++] = B64[(n >> 18) & 63];
    out[o++] = B64[(n >> 12) & 63];
    out[o++] = i + 1 < len ? B64[(n >> 6) & 63] : '=';
    out[o++] = i + 2 < len ? B64[n & 63] : '=';
  }
  out[o] = 0;
  return o;
}

static size_t b64Decode(const char *in, size_t len, uint8_t *out, size_t cap) {
  size_t o = 0;
  int val[4];
  int n = 0;
  for (size_t i = 0; i < len; i++) {
    if (in[i] == '=' || in[i] == '\n' || in[i] == '\r') continue;
    int v = b64Val(in[i]);
    if (v < 0) continue;
    val[n++] = v;
    if (n < 4) continue;
    if (o + 3 > cap) return 0;
    out[o++] = (uint8_t)((val[0] << 2) | (val[1] >> 4));
    out[o++] = (uint8_t)((val[1] << 4) | (val[2] >> 2));
    out[o++] = (uint8_t)((val[2] << 6) | val[3]);
    n = 0;
  }
  return o;
}

uint64_t pttNowMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)tv.tv_usec / 1000ULL;
}

static void topic(char *out, size_t cap, const char *suffix) {
  const char *line = lineId[0] ? lineId : LINE_ID;
  snprintf(out, cap, "sanket-ptt/v1/%s/%s", line, suffix);
}

static void publish(const char *path, const uint8_t *payload, size_t len, bool binary, bool retain) {
  if (!ready) return;
  static char encoded[6000];
  if (binary) {
    if (!b64Encode(payload, len, encoded, sizeof(encoded))) return;
  } else {
    if (len >= sizeof(encoded)) return;
    memcpy(encoded, payload, len);
    encoded[len] = 0;
  }
  JsonDocument doc;
  doc["op"] = "pub";
  doc["topic"] = path;
  doc["retain"] = retain;
  doc["encoding"] = binary ? "base64" : "utf8";
  doc["payload"] = encoded;
  String body;
  serializeJson(doc, body);
  socket.sendTXT(body);
}

static void publishText(const char *path, const char *json, bool retain) {
  publish(path, (const uint8_t *)json, strlen(json), false, retain);
}

static void sendHello() {
  JsonDocument doc;
  doc["op"] = "hello";
  doc["device"]["id"] = DEVICE_ID;
  doc["device"]["token"] = DEVICE_TOKEN;
#ifdef LISTEN_ONLY
  doc["device"]["listenOnly"] = true;
#endif
  String body;
  serializeJson(doc, body);
  socket.sendTXT(body);
  Serial.printf("Hello sent for %s (token length %u)\n", DEVICE_ID, (unsigned)strlen(DEVICE_TOKEN));
}

static void sendPresence() {
  if (!ready || !clockReady()) return;
  char json[240];
#ifdef LISTEN_ONLY
  const char *mode = ",\"listenOnly\":true";
#else
  const char *mode = "";
#endif
  snprintf(json, sizeof(json),
           "{\"id\":\"%s\",\"name\":\"%s\",\"ts\":%llu,\"kind\":\"handset\",\"rssi\":%d%s}",
           DEVICE_ID, HANDSET_NAME, (unsigned long long)pttNowMs(), WiFi.RSSI(), mode);
  char path[120];
  char suffix[48];
  snprintf(suffix, sizeof(suffix), "presence/%s", DEVICE_ID);
  topic(path, sizeof(path), suffix);
  publishText(path, json, true);
  Serial.println("Presence sent");
}

static void sendFloor(const char *kind, uint64_t ts) {
  char json[180];
  snprintf(json, sizeof(json), "{\"t\":\"%s\",\"id\":\"%s\",\"name\":\"%s\",\"ts\":%llu}", kind, DEVICE_ID, HANDSET_NAME, (unsigned long long)ts);
  char path[96];
  topic(path, sizeof(path), "floor");
  publishText(path, json, false);
}

static void onFloor(const char *json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return;
  const char *kind = doc["t"] | "";
  const char *id = doc["id"] | "";
  uint64_t ts = doc["ts"] | pttNowMs();
  if (!id[0]) return;
  if (strcmp(kind, "release") == 0) {
    if (strcmp(holder, id) == 0) holder[0] = 0;
    if (strcmp(id, DEVICE_ID) == 0) holding = false;
    return;
  }
  if (strcmp(kind, "claim") != 0 && strcmp(kind, "hb") != 0) return;
  if (strcmp(id, DEVICE_ID) == 0) return;
  bool earlier = holder[0] == 0 || ts < claimTs;
  if (earlier || strcmp(kind, "claim") == 0) {
    strlcpy(holder, id, sizeof(holder));
    if (holding) {
      holding = false;
      Serial.printf("Floor taken by %s\n", id);
    }
  }
}

static bool decodeFrame(const uint8_t *raw, size_t len, char *id, size_t idCap, int16_t *pcm, size_t pcmCap, size_t *samples) {
  if (len < 4) return false;
  bool versioned = (raw[0] & 0x80) != 0;
  size_t n = raw[0] & 0x7f;
  size_t start = 1 + n + (versioned ? 4 : 0);
  if (n < 1 || n > 40 || len < start + 2 || n + 1 > idCap) return false;
  memcpy(id, raw + 1, n);
  id[n] = 0;
  size_t bytes = len - start;
  bytes -= bytes % 2;
  size_t count = bytes / 2;
  if (count > pcmCap) count = pcmCap;
  memcpy(pcm, raw + start, count * 2);
  *samples = count;
  return count > 0;
}

static void onAudioPayload(const char *payload) {
  static uint8_t binary[4096];
  static int16_t pcm[1024];
  size_t n = b64Decode(payload, strlen(payload), binary, sizeof(binary));
  char id[41];
  size_t samples = 0;
  if (!n || !decodeFrame(binary, n, id, sizeof(id), pcm, 1024, &samples)) return;
  if (strcmp(id, DEVICE_ID) == 0) return;
  audioPushRx(pcm, samples);
  Serial.printf("Playing %u samples from %s\n", (unsigned)samples, id);
}

static void onText(const char *text, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, text, len)) return;
  const char *op = doc["op"] | "";
  if (strcmp(op, "ready") == 0) {
    strlcpy(lineId, doc["device"]["lineId"] | "", sizeof(lineId));
    ready = true;
    backoff = 1000;
    Serial.printf("Ready on line %s as %s\n", lineId, DEVICE_ID);
    if (strcmp(lineId, LINE_ID) != 0) {
      Serial.printf("Note: sketch LINE_ID is %s. Using the server line %s.\n", LINE_ID, lineId);
    }
    sendPresence();
    return;
  }
  if (strcmp(op, "err") == 0) {
    Serial.printf("Relay: %s\n", (const char *)(doc["message"] | "error"));
    backoff = 30000;
    socket.disconnect();
    return;
  }
  if (strcmp(op, "msg") != 0) return;
  const char *path = doc["topic"] | "";
  const char *encoding = doc["encoding"] | "";
  const char *payload = doc["payload"] | "";
  if (strcmp(encoding, "base64") == 0 && strstr(path, "/audio")) {
    onAudioPayload(payload);
    return;
  }
  if (strstr(path, "/floor")) onFloor(payload);
}

static void onEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    socketOpen = true;
    connecting = false;
    Serial.printf("WebSocket open, %s:%u/ws\n", SERVER_HOST, SERVER_PORT);
    sendHello();
    return;
  }
  if (type == WStype_DISCONNECTED) {
    if (socketOpen || connecting) Serial.println("WebSocket closed, retrying");
    socketOpen = false;
    ready = false;
    connecting = false;
    nextTry = millis() + backoff;
    if (backoff < 30000) backoff *= 2;
    return;
  }
  if (type == WStype_TEXT) onText((const char *)payload, length);
}

static void connectNow() {
  socket.onEvent(onEvent);
  socket.setReconnectInterval(0);
  Serial.printf("WebSocket connecting to %s:%u/ws\n", SERVER_HOST, SERVER_PORT);
  socket.beginSslWithCA(SERVER_HOST, SERVER_PORT, "/ws", ROOT_CA);
}

void pttBegin() {
  lineId[0] = 0;
  nextTry = millis();
  backoff = 1000;
}

void pttLoop() {
  socket.loop();
  if (!wifiUp() || !clockReady()) return;
  if (connecting && millis() - connectAt > 15000) {
    connecting = false;
    socket.disconnect();
    nextTry = millis() + backoff;
    Serial.println("WebSocket timed out, retrying");
  }
  if (!socketOpen && !connecting && (long)(millis() - nextTry) >= 0) {
    connecting = true;
    connectAt = millis();
    nextTry = millis() + backoff;
    connectNow();
  }
  if (ready && millis() - lastPresence >= PRESENCE_MS) {
    lastPresence = millis();
    sendPresence();
  }
}

bool pttReady() {
  return ready;
}

void pttPress(uint64_t nowMs) {
#ifdef LISTEN_ONLY
  (void)nowMs;
#else
  if (!ready || holding) return;
  holding = true;
  claimTs = nowMs;
  lastHb = nowMs;
  strlcpy(holder, DEVICE_ID, sizeof(holder));
  sendFloor("claim", claimTs);
  Serial.println("PTT down");
#endif
}

void pttRelease(uint64_t nowMs) {
#ifdef LISTEN_ONLY
  (void)nowMs;
#else
  bool mine = holding;
  holding = false;
  holder[0] = 0;
  if (!mine) return;
  char json[180];
  snprintf(json, sizeof(json), "{\"t\":\"release\",\"id\":\"%s\",\"name\":\"%s\",\"ts\":%llu}", DEVICE_ID, HANDSET_NAME, (unsigned long long)nowMs);
  char path[96];
  topic(path, sizeof(path), "floor");
  publishText(path, json, false);
  Serial.println("PTT up");
#endif
}

void pttFloorTick(uint64_t nowMs) {
#ifdef LISTEN_ONLY
  (void)nowMs;
#else
  if (!holding) return;
  if (nowMs - claimTs >= MAX_HOLD_MS) {
    pttRelease(nowMs);
    return;
  }
  if (strcmp(holder, DEVICE_ID) != 0) {
    holding = false;
    return;
  }
  if (nowMs - lastHb >= FLOOR_HEARTBEAT_MS) {
    lastHb = nowMs;
    sendFloor("hb", claimTs);
  }
#endif
}

bool pttMayTalk(uint64_t nowMs) {
#ifdef LISTEN_ONLY
  (void)nowMs;
  return false;
#else
  return holding && strcmp(holder, DEVICE_ID) == 0 && nowMs - claimTs >= CLAIM_GRACE_MS;
#endif
}

void pttSendAudio(const int16_t *pcm, size_t samples) {
#ifdef LISTEN_ONLY
  (void)pcm;
  (void)samples;
#else
  if (!ready || samples == 0) return;
  size_t idLen = strlen(DEVICE_ID);
  if (idLen < 1 || idLen > 40) return;
  static uint8_t frame[2400];
  size_t need = 1 + idLen + 4 + samples * 2;
  if (need > sizeof(frame)) return;
  frame[0] = (uint8_t)(idLen | 0x80);
  memcpy(frame + 1, DEVICE_ID, idLen);
  uint32_t n = seq++;
  memcpy(frame + 1 + idLen, &n, 4);
  memcpy(frame + 1 + idLen + 4, pcm, samples * 2);
  char path[96];
  topic(path, sizeof(path), "audio");
  publish(path, frame, need, true, false);
#endif
}
