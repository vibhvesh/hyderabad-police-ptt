#include "audio_out.h"
#include "codec.h"
#include "jitter.h"
#include "pins.h"
#include <Arduino.h>
#include <driver/i2s_std.h>

static i2s_chan_handle_t tx = nullptr;
static TaskHandle_t taskHandle = nullptr;
static volatile bool active = false;
static RateState rate{};

static void writeStereo(const int16_t *mono, size_t n) {
  int16_t stereo[512];
  size_t i = 0;
  while (i < n) {
    size_t take = n - i;
    if (take > 256) take = 256;
    for (size_t s = 0; s < take; s++) {
      stereo[s * 2] = mono[i + s];
      stereo[s * 2 + 1] = mono[i + s];
    }
    size_t wrote = 0;
    i2s_channel_write(tx, stereo, take * 4, &wrote, pdMS_TO_TICKS(50));
    i += take;
  }
}

static void task(void *) {
  int16_t block[480];
  int16_t up[640];
  for (;;) {
    if (!tx || !active) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    size_t n = jitterPull(block, sizeof(block) / sizeof(block[0]));
    if (!n) {
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }
    size_t m = resampleTo(&rate, block, n, SAMPLE_RATE_HZ, up, sizeof(up) / sizeof(up[0]), I2S_RATE_HZ);
    if (m) writeStereo(up, m);
  }
}

bool audioOutBegin() {
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
  if (i2s_new_channel(&chan, &tx, nullptr) != ESP_OK) return false;
  i2s_std_config_t cfg = {};
  cfg.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(I2S_RATE_HZ);
  cfg.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO);
  cfg.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.bclk = (gpio_num_t)PIN_AMP_BCLK;
  cfg.gpio_cfg.ws = (gpio_num_t)PIN_AMP_WS;
  cfg.gpio_cfg.dout = (gpio_num_t)PIN_AMP_DIN;
  cfg.gpio_cfg.din = I2S_GPIO_UNUSED;
  if (i2s_channel_init_std_mode(tx, &cfg) != ESP_OK) return false;
  if (i2s_channel_enable(tx) != ESP_OK) return false;
  xTaskCreatePinnedToCore(task, "amp", 6144, nullptr, 4, &taskHandle, 1);
  return true;
}

void audioOutSetActive(bool on) {
  active = on;
}
