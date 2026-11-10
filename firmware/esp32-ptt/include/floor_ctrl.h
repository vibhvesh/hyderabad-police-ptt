#pragma once

#include <stdint.h>

typedef void (*FloorPublishFn)(const char *json);

void floorBegin(const char *id, const char *name, FloorPublishFn publish);
void floorPress(uint64_t nowMs);
void floorRelease(uint64_t nowMs);
void floorTick(uint64_t nowMs);
void floorOnJson(const char *json, uint64_t nowMs);
bool floorCapture();
bool floorHolding();
bool floorTakeLost();
