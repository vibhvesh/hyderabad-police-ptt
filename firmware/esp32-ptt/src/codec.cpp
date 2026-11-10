#include "codec.h"
#include <cstring>

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

size_t encodeAudioFrame(const char *id, const int16_t *pcm, size_t samples, uint32_t seq, uint8_t *out, size_t cap) {
  size_t idLen = strlen(id);
  size_t need = 1 + idLen + 4 + samples * 2;
  if (idLen < 1 || idLen > 80 || need > cap) return 0;
  out[0] = (uint8_t)(idLen | 0x80);
  memcpy(out + 1, id, idLen);
  memcpy(out + 1 + idLen, &seq, 4);
  memcpy(out + 1 + idLen + 4, pcm, samples * 2);
  return need;
}

bool decodeAudioFrame(const uint8_t *raw, size_t len, char *id, size_t idCap, int16_t *pcm, size_t pcmCap, size_t *samples, uint32_t *seq, bool *hasSeq) {
  if (len < 4) return false;
  bool versioned = (raw[0] & 0x80) != 0;
  size_t n = raw[0] & 0x7f;
  size_t start = 1 + n + (versioned ? 4 : 0);
  if (n < 1 || n > 80 || len < start + 2 || n + 1 > idCap) return false;
  memcpy(id, raw + 1, n);
  id[n] = 0;
  *hasSeq = versioned;
  *seq = 0;
  if (versioned) memcpy(seq, raw + 1 + n, 4);
  size_t bytes = len - start;
  bytes -= bytes % 2;
  size_t count = bytes / 2;
  if (count > pcmCap) count = pcmCap;
  memcpy(pcm, raw + start, count * 2);
  *samples = count;
  return count > 0;
}

size_t resampleTo(RateState *state, const int16_t *in, size_t count, int inRate, int16_t *out, size_t cap, int outRate) {
  if (!in || !out || count == 0 || inRate <= 0 || outRate <= 0 || cap == 0) return 0;
  if (!state->primed) {
    state->prev = in[0];
    state->pos = 0;
    state->primed = true;
  }
  float step = (float)inRate / (float)outRate;
  size_t produced = 0;
  while (produced < cap && state->pos < (float)count) {
    size_t i0 = (size_t)state->pos;
    float frac = state->pos - (float)i0;
    int16_t a = i0 == 0 ? state->prev : in[i0 - 1];
    int16_t b = in[i0 < count ? i0 : count - 1];
    if (i0 < count) b = in[i0];
    out[produced++] = (int16_t)(a * (1.f - frac) + b * frac);
    state->pos += step;
  }
  if (count > 0) state->prev = in[count - 1];
  state->pos -= (float)count;
  if (state->pos < 0) state->pos = 0;
  return produced;
}

size_t base64Encode(const uint8_t *in, size_t len, char *out, size_t cap) {
  size_t need = ((len + 2) / 3) * 4 + 1;
  if (need > cap) return 0;
  size_t o = 0;
  for (size_t i = 0; i < len; i += 3) {
    uint32_t n = (uint32_t)in[i] << 16;
    if (i + 1 < len) n |= (uint32_t)in[i + 1] << 8;
    if (i + 2 < len) n |= in[i + 2];
    out[o++] = B64[(n >> 18) & 63];
    out[o++] = B64[(n >> 12) & 63];
    out[o++] = i + 1 < len ? B64[(n >> 6) & 63] : '=';
    out[o++] = i + 2 < len ? B64[n & 63] : '=';
  }
  out[o] = 0;
  return o;
}

static int b64Val(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

size_t base64Decode(const char *in, size_t len, uint8_t *out, size_t cap) {
  size_t o = 0;
  int val[4];
  int n = 0;
  for (size_t i = 0; i < len; i++) {
    if (in[i] == '=' || in[i] == '\n' || in[i] == '\r') continue;
    int v = b64Val(in[i]);
    if (v < 0) continue;
    val[n++] = v;
    if (n == 4) {
      if (o + 3 > cap) return 0;
      out[o++] = (uint8_t)((val[0] << 2) | (val[1] >> 4));
      out[o++] = (uint8_t)((val[1] << 4) | (val[2] >> 2));
      out[o++] = (uint8_t)((val[2] << 6) | val[3]);
      n = 0;
    }
  }
  return o;
}
