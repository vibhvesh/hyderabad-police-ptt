#include "floor_ctrl.h"
#include "pins.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <cstdio>
#include <cstring>

static char selfId[16] = "";
static char selfName[41] = "";
static char holder[16] = "";
static uint64_t claimTs = 0;
static uint64_t lastHb = 0;
static bool holding = false;
static bool lost = false;
static FloorPublishFn publishFn = nullptr;

static void publishKind(const char *kind) {
  if (!publishFn) return;
  char json[160];
  snprintf(json, sizeof(json), "{\"t\":\"%s\",\"id\":\"%s\",\"name\":\"%s\",\"ts\":%llu}", kind, selfId, selfName, (unsigned long long)claimTs);
  publishFn(json);
}

void floorBegin(const char *id, const char *name, FloorPublishFn publish) {
  strlcpy(selfId, id, sizeof(selfId));
  strlcpy(selfName, name, sizeof(selfName));
  publishFn = publish;
  holding = false;
  holder[0] = 0;
}

void floorPress(uint64_t nowMs) {
  if (holding) return;
  holding = true;
  lost = false;
  claimTs = nowMs;
  lastHb = nowMs;
  strlcpy(holder, selfId, sizeof(holder));
  publishKind("claim");
}

void floorRelease(uint64_t nowMs) {
  bool mine = holding && strcmp(holder, selfId) == 0;
  holding = false;
  holder[0] = 0;
  if (!mine || !publishFn) return;
  char json[160];
  snprintf(json, sizeof(json), "{\"t\":\"release\",\"id\":\"%s\",\"name\":\"%s\",\"ts\":%llu}", selfId, selfName, (unsigned long long)nowMs);
  publishFn(json);
}

void floorTick(uint64_t nowMs) {
  if (!holding) return;
  if (nowMs - claimTs >= MAX_HOLD_MS) {
    floorRelease(nowMs);
    return;
  }
  if (strcmp(holder, selfId) != 0) {
    holding = false;
    lost = true;
    return;
  }
  // The relay does not echo our heartbeat. Renew locally, then tell everyone else.
  if (nowMs - lastHb >= FLOOR_HEARTBEAT_MS) {
    lastHb = nowMs;
    publishKind("hb");
  }
}

void floorOnJson(const char *json, uint64_t nowMs) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return;
  const char *kind = doc["t"] | "";
  const char *id = doc["id"] | "";
  uint64_t ts = doc["ts"] | (uint64_t)nowMs;
  if (!id[0]) return;
  if (strcmp(kind, "release") == 0) {
    if (strcmp(holder, id) == 0) holder[0] = 0;
    if (strcmp(id, selfId) == 0) holding = false;
    return;
  }
  if (strcmp(kind, "claim") != 0 && strcmp(kind, "hb") != 0) return;
  bool earlier = holder[0] == 0 || ts < claimTs || (ts == claimTs && strcmp(id, holder) < 0);
  if (strcmp(id, selfId) == 0 || holder[0] == 0 || (strcmp(kind, "claim") == 0 && earlier) || (strcmp(kind, "hb") == 0 && earlier && strcmp(holder, selfId) != 0)) {
    strlcpy(holder, id, sizeof(holder));
    if (strcmp(id, selfId) != 0) {
      if (holding) lost = true;
      holding = false;
    }
  }
  (void)nowMs;
}

bool floorCapture() {
  if (!holding || strcmp(holder, selfId) != 0) return false;
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  uint64_t now = (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)tv.tv_usec / 1000ULL;
  return now - claimTs >= CLAIM_GRACE_MS;
}

bool floorHolding() {
  return holding;
}

bool floorTakeLost() {
  bool was = lost;
  lost = false;
  return was;
}
