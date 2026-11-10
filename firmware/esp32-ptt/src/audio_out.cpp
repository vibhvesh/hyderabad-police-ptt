#include "audio_out.h"
#include "board.h"
#include "codec.h"
#include "jitter.h"
#include "pins.h"
#include <Arduino.h>

static TaskHandle_t taskHandle = nullptr;
static volatile bool active = false;
static int gain = 256;
static RateState rate{};

static void writeStereo(const int16_t *mono, size_t n) {
  i2s_chan_handle_t tx = boardAmp();
  if (!tx) return;
  int16_t stereo[512];
  size_t i = 0;
  while (i < n) {
    size_t take = n - i;
    if (take > 256) take = 256;
    for (size_t s = 0; s < take; s++) {
      int sample = ((int)mono[i + s] * gain) / 256;
      if (sample > 32767) sample = 32767;
      if (sample < -32768) sample = -32768;
      stereo[s * 2] = (int16_t)sample;
      stereo[s * 2 + 1] = (int16_t)sample;
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
    if (!boardAmp() || !active) {
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
  xTaskCreatePinnedToCore(task, "amp", 6144, nullptr, 4, &taskHandle, 1);
  return boardAmp() != nullptr;
}

void audioGainStep(int direction) {
  gain += direction * 64;
  if (gain < 64) gain = 64;
  if (gain > 512) gain = 512;
}

void audioOutSetActive(bool on) {
  active = on;
  boardSpeaker(on);
}
