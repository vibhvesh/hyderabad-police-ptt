#include "audio_io.h"
#include "config.h"
#include <driver/i2s_std.h>
#include <string.h>

static i2s_chan_handle_t txChan = nullptr;
static i2s_chan_handle_t rxChan = nullptr;

static int16_t rxRing[12000];
static size_t rxWrite = 0;
static size_t rxCount = 0;
static portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;

#ifndef LISTEN_ONLY
static int16_t micRing[8192];
static size_t micWrite = 0;
static size_t micCount = 0;
static portMUX_TYPE micMux = portMUX_INITIALIZER_UNLOCKED;
#endif

struct Rate {
  float pos = 0;
  int16_t prev = 0;
  bool primed = false;
};

static size_t resample(Rate *state, const int16_t *in, size_t count, int inRate, int16_t *out, size_t cap, int outRate) {
  if (!count || !cap) return 0;
  if (!state->primed) {
    state->prev = in[0];
    state->pos = 0;
    state->primed = true;
  }
  float step = (float)inRate / (float)outRate;
  size_t produced = 0;
  while (produced < cap && state->pos < (float)count) {
    size_t i0 = (size_t)state->pos;
    float frac = state->pos - (float)i0;
    int16_t a = i0 == 0 ? state->prev : in[i0 - 1];
    int16_t b = in[i0 < count ? i0 : count - 1];
    out[produced++] = (int16_t)(a * (1.f - frac) + b * frac);
    state->pos += step;
  }
  state->prev = in[count - 1];
  state->pos -= (float)count;
  if (state->pos < 0) state->pos = 0;
  return produced;
}

static bool openOut() {
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
  if (i2s_new_channel(&chan, &txChan, nullptr) != ESP_OK) return false;
  i2s_std_config_t cfg = {};
  cfg.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(I2S_RATE_HZ);
  cfg.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO);
  cfg.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.bclk = (gpio_num_t)PIN_AMP_BCLK;
  cfg.gpio_cfg.ws = (gpio_num_t)PIN_AMP_WS;
  cfg.gpio_cfg.dout = (gpio_num_t)PIN_AMP_DOUT;
  cfg.gpio_cfg.din = I2S_GPIO_UNUSED;
  if (i2s_channel_init_std_mode(txChan, &cfg) != ESP_OK) return false;
  return i2s_channel_enable(txChan) == ESP_OK;
}

#ifndef LISTEN_ONLY
static bool openIn() {
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  if (i2s_new_channel(&chan, nullptr, &rxChan) != ESP_OK) return false;
  i2s_std_config_t cfg = {};
  cfg.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(I2S_RATE_HZ);
  cfg.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO);
  cfg.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  cfg.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.bclk = (gpio_num_t)PIN_MIC_BCLK;
  cfg.gpio_cfg.ws = (gpio_num_t)PIN_MIC_WS;
  cfg.gpio_cfg.dout = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.din = (gpio_num_t)PIN_MIC_DIN;
  if (i2s_channel_init_std_mode(rxChan, &cfg) != ESP_OK) return false;
  return i2s_channel_enable(rxChan) == ESP_OK;
}

static void micTask(void *) {
  uint8_t raw[1024];
  int16_t mid[256];
  int16_t down[256];
  Rate rate;
  for (;;) {
    size_t got = 0;
    if (!rxChan || i2s_channel_read(rxChan, raw, sizeof(raw), &got, pdMS_TO_TICKS(100)) != ESP_OK || got < 4) continue;
    size_t frames = got / sizeof(int32_t);
    if (frames > 256) frames = 256;
    const int32_t *in = (const int32_t *)raw;
    for (size_t i = 0; i < frames; i++) mid[i] = (int16_t)(in[i] >> 16);
    size_t n = resample(&rate, mid, frames, I2S_RATE_HZ, down, 256, SAMPLE_RATE_HZ);
    if (!n) continue;
    portENTER_CRITICAL(&micMux);
    for (size_t i = 0; i < n; i++) {
      micRing[micWrite] = down[i];
      micWrite = (micWrite + 1) % (sizeof(micRing) / sizeof(micRing[0]));
      if (micCount < sizeof(micRing) / sizeof(micRing[0])) micCount++;
    }
    portEXIT_CRITICAL(&micMux);
  }
}
#endif

static void playTask(void *) {
  int16_t block[480];
  int16_t up[640];
  int16_t stereo[512];
  Rate rate;
  for (;;) {
    size_t n = 0;
    portENTER_CRITICAL(&rxMux);
    n = rxCount < 480 ? rxCount : 480;
    size_t start = (rxWrite + sizeof(rxRing) / sizeof(rxRing[0]) - rxCount) % (sizeof(rxRing) / sizeof(rxRing[0]));
    for (size_t i = 0; i < n; i++) block[i] = rxRing[(start + i) % (sizeof(rxRing) / sizeof(rxRing[0]))];
    rxCount -= n;
    portEXIT_CRITICAL(&rxMux);
    if (!n || !txChan) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    size_t m = resample(&rate, block, n, SAMPLE_RATE_HZ, up, 640, I2S_RATE_HZ);
    size_t i = 0;
    while (i < m) {
      size_t take = m - i;
      if (take > 256) take = 256;
      for (size_t s = 0; s < take; s++) {
        stereo[s * 2] = up[i + s];
        stereo[s * 2 + 1] = up[i + s];
      }
      size_t wrote = 0;
      i2s_channel_write(txChan, stereo, take * 4, &wrote, pdMS_TO_TICKS(50));
      i += take;
    }
  }
}

bool audioBegin() {
  if (!openOut()) {
    Serial.println("Speaker I2S did not start");
    return false;
  }
#ifndef LISTEN_ONLY
  if (!openIn()) {
    Serial.println("Mic I2S did not start");
    return false;
  }
  xTaskCreatePinnedToCore(micTask, "mic", 6144, nullptr, 4, nullptr, 1);
#endif
  xTaskCreatePinnedToCore(playTask, "amp", 6144, nullptr, 4, nullptr, 1);
  Serial.println("Audio started");
  return true;
}

void audioPushRx(const int16_t *pcm, size_t samples) {
  portENTER_CRITICAL(&rxMux);
  for (size_t i = 0; i < samples; i++) {
    if (rxCount >= sizeof(rxRing) / sizeof(rxRing[0])) {
      rxCount--;
    }
    rxRing[rxWrite] = pcm[i];
    rxWrite = (rxWrite + 1) % (sizeof(rxRing) / sizeof(rxRing[0]));
    rxCount++;
  }
  portEXIT_CRITICAL(&rxMux);
}

size_t audioReadTx(int16_t *dst, size_t maxSamples) {
#ifdef LISTEN_ONLY
  (void)dst;
  (void)maxSamples;
  return 0;
#else
  portENTER_CRITICAL(&micMux);
  size_t n = micCount < maxSamples ? micCount : maxSamples;
  size_t start = (micWrite + sizeof(micRing) / sizeof(micRing[0]) - micCount) % (sizeof(micRing) / sizeof(micRing[0]));
  for (size_t i = 0; i < n; i++) dst[i] = micRing[(start + i) % (sizeof(micRing) / sizeof(micRing[0]))];
  micCount -= n;
  portEXIT_CRITICAL(&micMux);
  return n;
#endif
}

bool audioIdle() {
  portENTER_CRITICAL(&rxMux);
  bool idle = rxCount == 0;
  portEXIT_CRITICAL(&rxMux);
  return idle;
}
