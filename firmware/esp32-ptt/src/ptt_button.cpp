#include "ptt_button.h"
#include "pins.h"
#include <Arduino.h>

static bool stable = false;
static bool lastRead = false;
static unsigned long changeAt = 0;
static bool pressed = false;
static bool released = false;

void buttonBegin() {
  pinMode(PIN_PTT, INPUT_PULLUP);
  stable = digitalRead(PIN_PTT) == LOW;
  lastRead = stable;
}

void buttonTick(unsigned long nowMs) {
  bool down = digitalRead(PIN_PTT) == LOW;
  if (down != lastRead) {
    lastRead = down;
    changeAt = nowMs;
  }
  if (nowMs - changeAt < 30) return;
  if (down == stable) return;
  stable = down;
  if (down) pressed = true;
  else released = true;
}

bool buttonDown() { return stable; }
bool buttonPressedEdge() {
  bool was = pressed;
  pressed = false;
  return was;
}
bool buttonReleasedEdge() {
  bool was = released;
  released = false;
  return was;
}
