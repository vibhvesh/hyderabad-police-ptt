#include "audio_in.h"
#include "board.h"
#include "codec.h"
#include "pins.h"
#include <Arduino.h>
#include <cstring>

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
  uint8_t raw[1024];
  int16_t mid[256];
  int16_t down[256];
  for (;;) {
    i2s_chan_handle_t rx = boardMic();
    if (!rx) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    size_t got = 0;
    if (i2s_channel_read(rx, raw, sizeof(raw), &got, pdMS_TO_TICKS(100)) != ESP_OK || got < 4) continue;
    size_t frames = 0;
    if (boardRxBits() >= 32) {
      frames = got / sizeof(int32_t);
      if (frames > 256) frames = 256;
      const int32_t *in = reinterpret_cast<const int32_t *>(raw);
      for (size_t i = 0; i < frames; i++) mid[i] = (int16_t)(in[i] >> 16);
    } else {
      frames = got / 4;
      if (frames > 256) frames = 256;
      const int16_t *in = reinterpret_cast<const int16_t *>(raw);
      for (size_t i = 0; i < frames; i++) mid[i] = in[i * 2];
    }
    size_t n = resampleTo(&rate, mid, frames, I2S_RATE_HZ, down, sizeof(down) / sizeof(down[0]), SAMPLE_RATE_HZ);
    if (n) push(down, n);
  }
}

bool audioInBegin() {
  xTaskCreatePinnedToCore(task, "mic", 6144, nullptr, 4, &taskHandle, 1);
  return boardMic() != nullptr;
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
