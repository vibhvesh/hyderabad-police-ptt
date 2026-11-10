#include "battery.h"
#include "board.h"
#include <Arduino.h>

BatteryReport batteryRead() {
  const BoardProfile &board = boardProfile();
  if (board.batteryPin < 0) return {-1, 0.f};
  analogSetPinAttenuation(board.batteryPin, ADC_11db);
  int sample[16];
  int low = 10000;
  int high = 0;
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sample[i] = analogReadMilliVolts(board.batteryPin);
    if (sample[i] < low) low = sample[i];
    if (sample[i] > high) high = sample[i];
    sum += sample[i];
    delay(2);
  }
  if (high - low > 80) return {-1, 0.f};
  float voltage = ((sum / 16.f) / 1000.f) * board.batteryScale;
  if (voltage < board.batteryEmpty - 0.2f || voltage > board.batteryFull + 0.15f) return {-1, 0.f};
  int percent = (int)((voltage - board.batteryEmpty) / (board.batteryFull - board.batteryEmpty) * 100.f);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return {percent, voltage};
}
