#include "status_led.h"
#include "board.h"
#include <Arduino.h>

static LedMode mode = LED_SETUP;
static unsigned long last = 0;
static bool on = false;

static void wsBit(bool one) {
  int pin = boardProfile().ws2812Pin;
  if (one) {
    digitalWrite(pin, HIGH);
    delayMicroseconds(1);
    digitalWrite(pin, LOW);
  } else {
    digitalWrite(pin, HIGH);
    delayMicroseconds(0);
    digitalWrite(pin, LOW);
    delayMicroseconds(1);
  }
}

static void wsShow(uint8_t r, uint8_t g, uint8_t b) {
  noInterrupts();
  uint32_t grb = ((uint32_t)g << 16) | ((uint32_t)r << 8) | b;
  for (int i = 23; i >= 0; i--) wsBit((grb >> i) & 1);
  interrupts();
  digitalWrite(boardProfile().ws2812Pin, LOW);
}

static void write(bool lit) {
  const BoardProfile &board = boardProfile();
  if (board.ws2812Pin >= 0) {
    if (!lit) wsShow(0, 0, 0);
    else if (mode == LED_TALK) wsShow(40, 0, 0);
    else if (mode == LED_LISTEN) wsShow(0, 20, 30);
    else if (mode == LED_ONLINE) wsShow(0, 24, 0);
    else if (mode == LED_ERROR) wsShow(30, 10, 0);
    else wsShow(0, 0, 30);
  } else if (board.ledPin >= 0) {
    bool level = board.ledActiveLow ? !lit : lit;
    digitalWrite(board.ledPin, level ? HIGH : LOW);
  }
  on = lit;
}

void ledBegin() {
  const BoardProfile &board = boardProfile();
  if (board.ws2812Pin >= 0) {
    pinMode(board.ws2812Pin, OUTPUT);
    digitalWrite(board.ws2812Pin, LOW);
  } else if (board.ledPin >= 0) {
    pinMode(board.ledPin, OUTPUT);
  }
  write(false);
}

void ledSet(LedMode next) { mode = next; }

void ledTick(unsigned long nowMs) {
  unsigned long period = 1000;
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
}
