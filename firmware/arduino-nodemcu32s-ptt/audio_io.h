#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

bool audioBegin();
void audioPushRx(const int16_t *pcm, size_t samples);
size_t audioReadTx(int16_t *dst, size_t maxSamples);
bool audioIdle();
