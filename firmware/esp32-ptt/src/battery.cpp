#include "battery.h"
#include "board.h"
#include <Arduino.h>

BatteryReport batteryRead() {
  const BoardProfile &board = boardProfile();
  if (board.batteryPin < 0) return {-1, 0.f};
  analogSetPinAttenuation(board.batteryPin, ADC_11db);
  int mv = analogReadMilliVolts(board.batteryPin);
  float voltage = (mv / 1000.f) * board.batteryScale;
  int percent = (int)((voltage - board.batteryEmpty) / (board.batteryFull - board.batteryEmpty) * 100.f);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return {percent, voltage};
}
