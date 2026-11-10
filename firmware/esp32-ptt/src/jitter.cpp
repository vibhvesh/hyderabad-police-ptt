#include "jitter.h"
#include "pins.h"
#include <Arduino.h>
#include <cstring>

struct Slot {
  uint32_t seq = 0;
  int16_t *pcm = nullptr;
  size_t samples = 0;
  bool used = false;
};

static constexpr int kSlots = 24;
static constexpr size_t kMax = 1024;
static Slot slots[kSlots];
static int16_t play[8192];
static size_t playCount = 0;
static size_t playRead = 0;
static uint32_t nextSeq = 0;
static bool primed = false;
static bool haveNext = false;
static size_t held = 0;
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

static Slot *findEmpty() {
  for (int i = 0; i < kSlots; i++) if (!slots[i].used) return &slots[i];
  return nullptr;
}

static Slot *findSeq(uint32_t seq) {
  for (int i = 0; i < kSlots; i++) if (slots[i].used && slots[i].seq == seq) return &slots[i];
  return nullptr;
}

static void enqueue(Slot *slot) {
  if (playCount + slot->samples > sizeof(play) / sizeof(play[0])) return;
  memcpy(play + playCount, slot->pcm, slot->samples * sizeof(int16_t));
  playCount += slot->samples;
  held -= slot->samples;
  slot->used = false;
  nextSeq++;
}

static void flush() {
  bool skipped = false;
  if (haveNext && !findSeq(nextSeq) && playRead >= playCount) {
    uint32_t lowest = 0;
    bool any = false;
    for (int i = 0; i < kSlots; i++) {
      if (!slots[i].used) continue;
      if (!any || slots[i].seq < lowest) {
        lowest = slots[i].seq;
        any = true;
      }
    }
    if (any && lowest > nextSeq) {
      nextSeq = lowest;
      skipped = true;
    }
    (void)skipped;
  }
  while (haveNext) {
    Slot *slot = findSeq(nextSeq);
    if (!slot) break;
    enqueue(slot);
  }
}

void jitterBegin() {
  for (int i = 0; i < kSlots; i++) {
    if (!slots[i].pcm) slots[i].pcm = (int16_t *)heap_caps_malloc(kMax * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!slots[i].pcm) slots[i].pcm = (int16_t *)malloc(kMax * sizeof(int16_t));
    slots[i].used = false;
  }
}

void jitterReset() {
  portENTER_CRITICAL(&mux);
  for (int i = 0; i < kSlots; i++) slots[i].used = false;
  playCount = 0;
  playRead = 0;
  primed = false;
  haveNext = false;
  held = 0;
  portEXIT_CRITICAL(&mux);
}

void jitterPush(uint32_t seq, bool hasSeq, const int16_t *pcm, size_t samples) {
  if (!pcm || samples == 0) return;
  if (samples > kMax) samples = kMax;
  portENTER_CRITICAL(&mux);
  if (!hasSeq) seq = haveNext ? nextSeq + held : 0;
  if (findSeq(seq)) {
    portEXIT_CRITICAL(&mux);
    return;
  }
  Slot *slot = findEmpty();
  if (!slot || !slot->pcm) {
    portEXIT_CRITICAL(&mux);
    return;
  }
  memcpy(slot->pcm, pcm, samples * sizeof(int16_t));
  slot->seq = seq;
  slot->samples = samples;
  slot->used = true;
  held += samples;
  if (!haveNext || (!primed && seq < nextSeq)) {
    nextSeq = seq;
    haveNext = true;
  }
  size_t target = (size_t)SAMPLE_RATE_HZ * PLAYOUT_TARGET_MS / 1000;
  if (!primed && held >= target) primed = true;
  if (primed) flush();
  portEXIT_CRITICAL(&mux);
}

size_t jitterPull(int16_t *dst, size_t maxSamples) {
  portENTER_CRITICAL(&mux);
  if (playRead >= playCount && primed) flush();
  size_t have = playCount > playRead ? playCount - playRead : 0;
  size_t n = have < maxSamples ? have : maxSamples;
  if (n > 0) {
    memcpy(dst, play + playRead, n * sizeof(int16_t));
    playRead += n;
    if (playRead >= playCount) {
      playRead = 0;
      playCount = 0;
    }
  }
  portEXIT_CRITICAL(&mux);
  return n;
}

bool jitterIdle() {
  portENTER_CRITICAL(&mux);
  bool idle = playRead >= playCount && held == 0;
  portEXIT_CRITICAL(&mux);
  return idle;
}
