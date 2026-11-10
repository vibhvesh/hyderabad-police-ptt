#include "battery.h"
#include "pins.h"
#include <Arduino.h>

BatteryReport batteryRead() {
  analogSetPinAttenuation(PIN_BATTERY, ADC_11db);
  int mv = analogReadMilliVolts(PIN_BATTERY);
  float voltage = (mv / 1000.f) * 2.f;
  int percent = (int)((voltage - 3.30f) / (4.20f - 3.30f) * 100.f);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return {percent, voltage};
}
