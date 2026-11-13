#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

void pttBegin();
void pttLoop();
bool pttReady();
void pttPress(uint64_t nowMs);
void pttRelease(uint64_t nowMs);
void pttFloorTick(uint64_t nowMs);
bool pttMayTalk(uint64_t nowMs);
void pttSendAudio(const int16_t *pcm, size_t samples);
uint64_t pttNowMs();
