#pragma once

#include <stddef.h>
#include <stdint.h>

// Same idea as LivePlayout in src/lib/playback.ts: hold ~200 ms, play at 1x, do not overlap.
void jitterBegin();
void jitterPush(uint32_t seq, bool hasSeq, const int16_t *pcm, size_t samples);
size_t jitterPull(int16_t *dst, size_t maxSamples);
bool jitterIdle();
void jitterReset();
