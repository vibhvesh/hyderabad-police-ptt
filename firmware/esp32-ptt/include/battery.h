#pragma once

struct BatteryReport {
  int percent;
  float voltage;
};

BatteryReport batteryRead();
