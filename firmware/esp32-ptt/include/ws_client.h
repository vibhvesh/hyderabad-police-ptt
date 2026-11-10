#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

typedef void (*WsAudioFn)(const char *id, const int16_t *pcm, size_t samples, uint32_t seq, bool hasSeq);
typedef void (*WsJsonFn)(const char *topic, const char *body);
typedef void (*WsReadyFn)(const char *lineId, const char *name);
typedef void (*WsStatusFn)(bool online);

void wsBegin(const char *serverUrl, const char *deviceId, const char *token, bool tlsInsecure);
void wsLoop();
bool wsOnline();
bool wsTimeReady();
void wsPublish(const char *topic, const uint8_t *payload, size_t len, bool binary, bool retain);
void wsPublishText(const char *topic, const char *json, bool retain);
void wsOnAudio(WsAudioFn fn);
void wsOnJson(WsJsonFn fn);
void wsOnReady(WsReadyFn fn);
void wsOnStatus(WsStatusFn fn);
int wsRssi();
const char *wsLine();
