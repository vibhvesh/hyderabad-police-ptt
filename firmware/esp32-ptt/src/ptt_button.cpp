#include "ptt_button.h"
#include "board.h"
#include <Arduino.h>

static bool stable = false;
static bool lastRead = false;
static unsigned long changeAt = 0;
static bool pressed = false;
static bool released = false;

static bool rawDown() {
  const BoardProfile &board = boardProfile();
  int level = digitalRead(board.buttonPin);
  return board.buttonActiveLow ? level == LOW : level == HIGH;
}

void buttonBegin() {
  const BoardProfile &board = boardProfile();
  pinMode(board.buttonPin, board.buttonPullup ? INPUT_PULLUP : INPUT);
  stable = rawDown();
  lastRead = stable;
}

void buttonTick(unsigned long nowMs) {
  bool down = rawDown();
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
