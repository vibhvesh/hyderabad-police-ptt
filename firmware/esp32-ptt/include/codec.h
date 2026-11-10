#pragma once

#include <stddef.h>
#include <stdint.h>

// Packet layout matches src/lib/packets.ts: [idLen|0x80][id][uint32 LE seq][int16 LE pcm].

struct RateState {
  float pos;
  int16_t prev;
  bool primed;
};

size_t encodeAudioFrame(const char *id, const int16_t *pcm, size_t samples, uint32_t seq, uint8_t *out, size_t cap);
bool decodeAudioFrame(const uint8_t *raw, size_t len, char *id, size_t idCap, int16_t *pcm, size_t pcmCap, size_t *samples, uint32_t *seq, bool *hasSeq);
size_t resampleTo(RateState *state, const int16_t *in, size_t count, int inRate, int16_t *out, size_t cap, int outRate);
size_t base64Encode(const uint8_t *in, size_t len, char *out, size_t cap);
size_t base64Decode(const char *in, size_t len, uint8_t *out, size_t cap);
