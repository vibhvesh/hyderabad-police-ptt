#include "status_led.h"
#include "pins.h"
#include <Arduino.h>

static LedMode mode = LED_SETUP;
static unsigned long last = 0;
static bool on = false;

#if USE_WS2812
static void wsBit(bool one) {
  if (one) {
    digitalWrite(PIN_WS2812, HIGH);
    delayMicroseconds(1);
    digitalWrite(PIN_WS2812, LOW);
  } else {
    digitalWrite(PIN_WS2812, HIGH);
    delayMicroseconds(0);
    digitalWrite(PIN_WS2812, LOW);
    delayMicroseconds(1);
  }
}
static void wsShow(uint8_t r, uint8_t g, uint8_t b) {
  noInterrupts();
  uint32_t grb = ((uint32_t)g << 16) | ((uint32_t)r << 8) | b;
  for (int i = 23; i >= 0; i--) wsBit((grb >> i) & 1);
  interrupts();
  digitalWrite(PIN_WS2812, LOW);
}
#endif

static void write(bool lit) {
#if USE_WS2812
  if (!lit) {
    wsShow(0, 0, 0);
    return;
  }
  if (mode == LED_TALK) wsShow(40, 0, 0);
  else if (mode == LED_LISTEN) wsShow(0, 20, 30);
  else if (mode == LED_ONLINE) wsShow(0, 24, 0);
  else if (mode == LED_ERROR) wsShow(30, 10, 0);
  else wsShow(0, 0, 30);
#else
  digitalWrite(PIN_LED, (lit ^ LED_ACTIVE_LOW) ? HIGH : LOW);
#endif
  on = lit;
}

void ledBegin() {
#if USE_WS2812
  pinMode(PIN_WS2812, OUTPUT);
  digitalWrite(PIN_WS2812, LOW);
#else
  pinMode(PIN_LED, OUTPUT);
#endif
  write(false);
}

void ledSet(LedMode next) { mode = next; }

void ledTick(unsigned long nowMs) {
  unsigned long period = 1000;
  bool lit = true;
  if (mode == LED_SETUP) period = 1000;
  else if (mode == LED_CONNECTING) period = 200;
  else if (mode == LED_TALK) period = 120;
  else if (mode == LED_LISTEN) period = 400;
  else if (mode == LED_ERROR) period = 120;
  else {
    write(true);
    return;
  }
  if (nowMs - last < period / 2) return;
  last = nowMs;
  write(!on);
  (void)lit;
}
