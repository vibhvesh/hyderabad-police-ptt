#include "audio_io.h"
#include "config.h"
#include "ptt_stream.h"
#include "wifi_link.h"

// NodeMCU-32S handset. Fill in config.h, then upload from the Arduino IDE.
// Serial is 115200. The LED is the onboard one on GPIO2 (active low).

enum LedMode { LED_WIFI, LED_STREAM, LED_ONLINE, LED_TALK };
static LedMode ledMode = LED_WIFI;
static bool pttWas = false;
static bool sending = false;
static uint64_t tailUntil = 0;

static void ledWrite(bool on) {
  digitalWrite(PIN_LED, on ? LOW : HIGH);
}

static void ledTick() {
  unsigned long now = millis();
  if (ledMode == LED_ONLINE) {
    ledWrite(true);
    return;
  }
  unsigned period = ledMode == LED_TALK ? 120 : ledMode == LED_STREAM ? 400 : 900;
  ledWrite(((now / period) % 2) == 0);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_LED, OUTPUT);
  ledWrite(false);
  pinMode(PIN_PTT, INPUT_PULLUP);
  Serial.println("NodeMCU-32S PTT");
#ifdef LISTEN_ONLY
  Serial.println("Listen only");
#endif
  wifiBegin();
  audioBegin();
  pttBegin();
}

void loop() {
  wifiLoop();
  if (!wifiUp()) ledMode = LED_WIFI;
  else if (!clockReady()) {
    ledMode = LED_STREAM;
    static unsigned long told = 0;
    if (millis() - told > 2000) {
      told = millis();
      Serial.println("Waiting for clock");
    }
  }
  pttLoop();
  if (wifiUp() && clockReady()) {
    if (!pttReady()) ledMode = LED_STREAM;
    else if (ledMode != LED_TALK) ledMode = LED_ONLINE;
  }

#ifndef LISTEN_ONLY
  bool down = digitalRead(PIN_PTT) == LOW;
  uint64_t now = pttNowMs();
  if (down && !pttWas && pttReady()) pttPress(now);
  if (!down && pttWas) tailUntil = now + TAIL_MS;
  pttWas = down;
  pttFloorTick(now);
  if (pttMayTalk(now)) {
    if (!sending) {
      sending = true;
      ledMode = LED_TALK;
      Serial.println("Sending audio");
    }
    int16_t chunk[CHUNK_SAMPLES];
    if (audioReadTx(chunk, CHUNK_SAMPLES) == CHUNK_SAMPLES) pttSendAudio(chunk, CHUNK_SAMPLES);
  } else if (sending && (!down || now >= tailUntil)) {
    sending = false;
    pttRelease(now);
    ledMode = pttReady() ? LED_ONLINE : LED_STREAM;
  }
#else
  (void)pttWas;
  (void)sending;
  (void)tailUntil;
#endif

  if (pttReady() && !audioIdle() && ledMode != LED_TALK) ledMode = LED_ONLINE;
  ledTick();
  delay(5);
}
