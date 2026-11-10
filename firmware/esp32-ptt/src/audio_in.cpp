#include "audio_in.h"
#include "codec.h"
#include "pins.h"
#include <Arduino.h>
#include <driver/i2s_std.h>
#include <cstring>

static i2s_chan_handle_t rx = nullptr;
static int16_t ring[8192];
static size_t writeAt = 0;
static size_t count = 0;
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static RateState rate{};
static TaskHandle_t taskHandle = nullptr;

static void push(const int16_t *pcm, size_t n) {
  portENTER_CRITICAL(&mux);
  for (size_t i = 0; i < n; i++) {
    ring[writeAt] = pcm[i];
    writeAt = (writeAt + 1) % (sizeof(ring) / sizeof(ring[0]));
    if (count < sizeof(ring) / sizeof(ring[0])) count++;
  }
  portEXIT_CRITICAL(&mux);
}

static void task(void *) {
  int32_t raw[256];
  int16_t mid[256];
  int16_t down[256];
  for (;;) {
    if (!rx) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    size_t got = 0;
    if (i2s_channel_read(rx, raw, sizeof(raw), &got, pdMS_TO_TICKS(100)) != ESP_OK || got < 4) continue;
    size_t frames = got / sizeof(int32_t);
    for (size_t i = 0; i < frames; i++) mid[i] = (int16_t)(raw[i] >> 16);
    size_t n = resampleTo(&rate, mid, frames, I2S_RATE_HZ, down, sizeof(down) / sizeof(down[0]), SAMPLE_RATE_HZ);
    if (n) push(down, n);
  }
}

bool audioInBegin() {
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  if (i2s_new_channel(&chan, nullptr, &rx) != ESP_OK) return false;
  i2s_std_config_t cfg = {};
  cfg.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(I2S_RATE_HZ);
  cfg.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO);
  cfg.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  cfg.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.bclk = (gpio_num_t)PIN_MIC_BCLK;
  cfg.gpio_cfg.ws = (gpio_num_t)PIN_MIC_WS;
  cfg.gpio_cfg.dout = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.din = (gpio_num_t)PIN_MIC_SD;
  if (i2s_channel_init_std_mode(rx, &cfg) != ESP_OK) return false;
  if (i2s_channel_enable(rx) != ESP_OK) return false;
  xTaskCreatePinnedToCore(task, "mic", 6144, nullptr, 4, &taskHandle, 1);
  return true;
}

size_t audioInRead(int16_t *dst, size_t maxSamples) {
  portENTER_CRITICAL(&mux);
  size_t n = count < maxSamples ? count : maxSamples;
  size_t start = (writeAt + sizeof(ring) / sizeof(ring[0]) - count) % (sizeof(ring) / sizeof(ring[0]));
  for (size_t i = 0; i < n; i++) dst[i] = ring[(start + i) % (sizeof(ring) / sizeof(ring[0]))];
  count -= n;
  portEXIT_CRITICAL(&mux);
  return n;
}

size_t audioInPreRoll(int16_t *dst, size_t maxSamples) {
  size_t want = (size_t)SAMPLE_RATE_HZ * PRE_ROLL_MS / 1000;
  if (want > maxSamples) want = maxSamples;
  portENTER_CRITICAL(&mux);
  size_t n = count < want ? count : want;
  size_t start = (writeAt + sizeof(ring) / sizeof(ring[0]) - n) % (sizeof(ring) / sizeof(ring[0]));
  for (size_t i = 0; i < n; i++) dst[i] = ring[(start + i) % (sizeof(ring) / sizeof(ring[0]))];
  count = 0;
  portEXIT_CRITICAL(&mux);
  return n;
}
