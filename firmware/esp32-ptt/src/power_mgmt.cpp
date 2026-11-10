#include "power_mgmt.h"
#include <esp_sleep.h>
#include <esp_wifi.h>

void powerSetRadioActive(bool active) {
  esp_wifi_set_ps(active ? WIFI_PS_NONE : WIFI_PS_MIN_MODEM);
}

void powerDeepSleep(int wakePin) {
  esp_sleep_enable_ext0_wakeup((gpio_num_t)wakePin, 0);
  esp_deep_sleep_start();
}
