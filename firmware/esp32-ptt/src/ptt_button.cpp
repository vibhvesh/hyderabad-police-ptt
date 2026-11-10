#include "ptt_button.h"
#include "board.h"
#include <Arduino.h>

static bool stable = false;
static bool lastRead = false;
static unsigned long changeAt = 0;
static bool pressed = false;
static bool released = false;

static void arm(int pin, bool pull) {
  if (pin < 0) return;
  bool canPull = pull && pin <= 33;
  pinMode(pin, canPull ? INPUT_PULLUP : INPUT);
}

static bool pinDown(int pin) {
  if (pin < 0) return false;
  const BoardProfile &board = boardProfile();
  int level = digitalRead(pin);
  return board.buttonActiveLow ? level == LOW : level == HIGH;
}

static bool rawDown() {
  const BoardProfile &board = boardProfile();
  return pinDown(board.buttonPin) || pinDown(board.extPttPin) || pinDown(board.extraPttPin);
}

void buttonBegin() {
  const BoardProfile &board = boardProfile();
  arm(board.buttonPin, board.buttonPullup);
  arm(board.extPttPin, true);
  arm(board.extraPttPin, true);
  stable = rawDown();
  lastRead = stable;
}

void buttonTick(unsigned long nowMs) {
  bool down = rawDown();
  if (down != lastRead) {
    lastRead = down;
    changeAt = nowMs;
  }
  if (nowMs - changeAt < 40) return;
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
