#pragma once

#include <Arduino.h>

struct HandsetConfig {
  String ssid;
  String password;
  String server;
  String lineId;
  String deviceId;
  String token;
  String name;
  bool tlsInsecure;
  bool deepSleepIdle;
  bool valid;
};

HandsetConfig configLoad();
void configSave(const HandsetConfig &cfg);
void configClear();
