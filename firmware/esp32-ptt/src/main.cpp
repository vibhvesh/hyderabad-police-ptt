#include "audio_in.h"
#include "board.h"
#include "audio_out.h"
#include "battery.h"
#include "codec.h"
#include "config_store.h"
#include "floor_ctrl.h"
#include "jitter.h"
#include "pins.h"
#include "power_mgmt.h"
#include "ptt_button.h"
#include "status_led.h"
#include "wifi_provision.h"
#include "ws_client.h"
#include <WiFi.h>
#include <cstring>
#include <time.h>

static HandsetConfig cfg;
static uint32_t seq = 0;
static bool tx = false;
static uint64_t txUntil = 0;
static unsigned long lastPresence = 0;
static unsigned long idleSince = 0;
static char selfId[16] = "";

static uint64_t epochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)tv.tv_usec / 1000ULL;
}

static void topic(char *out, size_t cap, const char *suffix) {
  snprintf(out, cap, "sanket-ptt/v1/%s/%s", wsLine()[0] ? wsLine() : cfg.lineId.c_str(), suffix);
}

static void publishFloor(const char *json) {
  char path[96];
  topic(path, sizeof(path), "floor");
  wsPublishText(path, json, false);
}

static void sendChunk(const int16_t *pcm, size_t n) {
  uint8_t frame[2200];
  size_t bytes = encodeAudioFrame(selfId, pcm, n, seq++, frame, sizeof(frame));
  if (!bytes) return;
  char path[96];
  topic(path, sizeof(path), "audio");
  wsPublish(path, frame, bytes, true, false);
}

static void sendPresence() {
  if (!wsOnline() || !wsTimeReady()) return;
  BatteryReport bat = batteryRead();
  char json[240];
#ifdef LISTEN_ONLY
  const char *mode = ",\"listenOnly\":true";
#else
  const char *mode = "";
#endif
  if (bat.percent >= 0) {
    snprintf(json, sizeof(json),
             "{\"id\":\"%s\",\"name\":\"%s\",\"ts\":%llu,\"kind\":\"handset\",\"battery\":%d,\"voltage\":%.2f,\"rssi\":%d,\"charging\":false%s}",
             selfId, cfg.name.c_str(), (unsigned long long)epochMs(), bat.percent, bat.voltage, wsRssi(), mode);
  } else {
    snprintf(json, sizeof(json),
             "{\"id\":\"%s\",\"name\":\"%s\",\"ts\":%llu,\"kind\":\"handset\",\"rssi\":%d%s}",
             selfId, cfg.name.c_str(), (unsigned long long)epochMs(), wsRssi(), mode);
  }
  char path[96];
  snprintf(path, sizeof(path), "presence/%s", selfId);
  char full[120];
  topic(full, sizeof(full), path);
  wsPublishText(full, json, true);
}

static void onAudio(const char *id, const int16_t *pcm, size_t samples, uint32_t packetSeq, bool hasSeq) {
  if (strcmp(id, selfId) == 0) return;
  jitterPush(packetSeq, hasSeq, pcm, samples);
  audioOutSetActive(true);
  ledSet(LED_LISTEN);
}

static void onJson(const char *path, const char *body) {
  if (strstr(path, "/floor")) floorOnJson(body, epochMs());
}

static void onReady(const char *lineId, const char *) {
  Serial.printf("On line %s as %s\n", lineId, selfId);
  floorBegin(selfId, cfg.name.c_str(), publishFloor);
  sendPresence();
}

static void onLink(bool up) {
  ledSet(up ? LED_ONLINE : LED_CONNECTING);
  if (!up) audioOutSetActive(false);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  ledBegin();
  ledSet(LED_SETUP);
  cfg = configLoad();
  if (!cfg.valid || provisionRequestedAtBoot()) provisionBlock(cfg);
  strlcpy(selfId, cfg.deviceId.c_str(), sizeof(selfId));
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid.c_str(), cfg.password.c_str());
  Serial.printf("Joining %s\n", cfg.ssid.c_str());
  jitterBegin();
  buttonBegin();
  if (!boardAudioBegin()) Serial.println("Board audio did not start");
#ifndef LISTEN_ONLY
  if (!audioInBegin()) Serial.println("Mic did not start");
#endif
  if (!audioOutBegin()) Serial.println("Amp did not start");
  wsOnAudio(onAudio);
  wsOnJson(onJson);
  wsOnReady(onReady);
  wsOnStatus(onLink);
  ledSet(LED_CONNECTING);
  idleSince = millis();
}

#ifdef LISTEN_ONLY
static void pollVolume();
#endif

void loop() {
  unsigned long now = millis();
  ledTick(now);
  buttonTick(now);
  if (WiFi.status() != WL_CONNECTED) {
    ledSet(LED_CONNECTING);
    delay(20);
    return;
  }
  static bool wsStarted = false;
  if (!wsStarted) {
    wsBegin(cfg.server.c_str(), selfId, cfg.token.c_str(), cfg.tlsInsecure);
    wsStarted = true;
  }
  wsLoop();
  if (!wsTimeReady()) {
    ledSet(LED_CONNECTING);
    delay(10);
    return;
  }
  uint64_t clock = epochMs();
#ifdef LISTEN_ONLY
  pollVolume();
#else
  if (buttonPressedEdge() && wsOnline()) floorPress(clock);
  if (buttonReleasedEdge()) txUntil = clock + TAIL_MS;
  floorTick(clock);
  if (floorTakeLost()) tx = false;
  bool capture = floorCapture();
  if (capture && !tx) {
    int16_t pre[6000];
    size_t n = audioInPreRoll(pre, sizeof(pre) / sizeof(pre[0]));
    for (size_t i = 0; i < n; i += CHUNK_SAMPLES) {
      size_t take = n - i;
      if (take > CHUNK_SAMPLES) take = CHUNK_SAMPLES;
      sendChunk(pre + i, take);
    }
    tx = true;
    ledSet(LED_TALK);
    powerSetRadioActive(true);
  }
  if (tx) {
    int16_t chunk[CHUNK_SAMPLES];
    size_t n = audioInRead(chunk, CHUNK_SAMPLES);
    if (n == CHUNK_SAMPLES) sendChunk(chunk, n);
    if (!capture && clock >= txUntil) {
      tx = false;
      floorRelease(clock);
      ledSet(LED_ONLINE);
    }
  }
#endif
  if (!jitterIdle()) {
    audioOutSetActive(true);
    idleSince = now;
  } else if (!tx) {
    audioOutSetActive(false);
    powerSetRadioActive(false);
    if (!buttonDown() && !floorHolding()) ledSet(LED_ONLINE);
  } else {
    idleSince = now;
    powerSetRadioActive(true);
  }
  if (now - lastPresence >= PRESENCE_MS) {
    lastPresence = now;
    sendPresence();
  }
  if (cfg.deepSleepIdle && !tx && jitterIdle() && !buttonDown() && now - idleSince > 15UL * 60UL * 1000UL) {
    Serial.println("Deep sleep until the button is pressed");
    powerDeepSleep(boardProfile().buttonPin);
  }
  delay(5);
}

#ifdef LISTEN_ONLY
static void pollVolume() {
  const BoardProfile &board = boardProfile();
  static bool downWas = false;
  static bool upWas = false;
  if (board.volDownPin >= 0) {
    pinMode(board.volDownPin, INPUT_PULLUP);
    bool down = digitalRead(board.volDownPin) == LOW;
    if (down && !downWas) audioGainStep(-1);
    downWas = down;
  }
  if (board.volUpPin >= 0) {
    pinMode(board.volUpPin, INPUT_PULLUP);
    bool up = digitalRead(board.volUpPin) == LOW;
    if (up && !upWas) audioGainStep(1);
    upWas = up;
  }
}
#endif
