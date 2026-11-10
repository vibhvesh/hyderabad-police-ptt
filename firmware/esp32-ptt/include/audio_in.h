#pragma once

#include <stddef.h>
#include <stdint.h>

bool audioInBegin();
size_t audioInRead(int16_t *dst, size_t maxSamples);
size_t audioInPreRoll(int16_t *dst, size_t maxSamples);
