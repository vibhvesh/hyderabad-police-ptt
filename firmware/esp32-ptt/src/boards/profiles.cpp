#include "board.h"

static const BoardProfile kXiao = {
  "xiao_esp32s3_inmp441_max98357a",
  "Seeed XIAO ESP32-S3, INMP441, MAX98357A",
  {1, 2, 3, 4, -1, 16, false, 0, 7, 8, 9, 32},
  BOARD_CODEC_NONE,
  BOARD_ADC_NONE,
  -1, -1, 0, 0,
  -1, true,
  1, true, true,
  21, true,
  -1,
  6, 2.f, 3.30f, 4.20f,
  -1, -1, 1, -1, false,
  -1, -1,
};

// Boondock kit. Pins are the ES8388 v1 map until boardPrepareCodec probes the chip.
// KEY1 is GPIO36. The large external button is header IO19. KEY6 is a second onboard PTT
// unless that pin is the AC101 headphone switch or the ES8388 v2 bit clock.
static const BoardProfile kA1s = {
  "esp32-a1s",
  "AI-Thinker ESP32-A1S Audio Kit",
  {0, 27, 25, 26, 0, 16, true, 0, 27, 25, 35, 16},
  BOARD_CODEC_ES8388,
  BOARD_ADC_SAME,
  33, 32, 0x10, 0,
  21, true,
  36, true, false,
  22, false,
  -1,
  34, 2.f, 3.30f, 4.20f,
  19, 5, 19, 39, true,
  -1, -1,
};

// NodeMCU-32S is an ESP32-WROOM-32 dev board. No PSRAM. Same mic and amp chips as the XIAO.
// Two I2S ports so the mic and the amp do not share a clock. GPIO34 is ADC1, so Wi-Fi does not block the battery reading.
static const BoardProfile kNodeMcu32s = {
  "nodemcu-32s",
  "NodeMCU-32S, INMP441, MAX98357A",
  {1, 27, 14, 13, -1, 16, false, 0, 26, 25, 32, 32},
  BOARD_CODEC_NONE,
  BOARD_ADC_NONE,
  -1, -1, 0, 0,
  -1, true,
  4, true, true,
  2, true,
  -1,
  34, 2.f, 3.30f, 4.20f,
  -1, -1, 4, -1, false,
  16, 17,
};

static const BoardProfile kLyrat = {
  "lyrat_v43_es8388",
  "ESP32-LyraT v4.3, ES8388",
  {0, 5, 25, 26, 0, 16, true, 0, 5, 25, 35, 16},
  BOARD_CODEC_ES8388,
  BOARD_ADC_SAME,
  18, 23, 0x10, 0,
  21, true,
  36, true, false,
  22, false,
  -1,
  -1, 2.f, 3.30f, 4.20f,
  -1, -1, 36, -1, false,
  -1, -1,
};

static const BoardProfile kKorvo = {
  "s3_korvo2_es8311",
  "ESP32-S3-Korvo-2, ES8311 and ES7210",
  {0, 9, 45, 8, 16, 16, true, 0, 9, 45, 10, 16},
  BOARD_CODEC_ES8311,
  BOARD_ADC_ES7210,
  17, 18, 0x18, 0x40,
  48, true,
  0, true, true,
  -1, true,
  -1,
  -1, 2.f, 3.30f, 4.20f,
  -1, -1, 0, -1, false,
  -1, -1,
};

static BoardProfile gLive = kA1s;
static bool gReady = false;

const BoardProfile &boardProfile() {
  if (!gReady) {
#if defined(BOARD_XIAO_INMP441)
    gLive = kXiao;
#elif defined(BOARD_NODEMCU_32S)
    gLive = kNodeMcu32s;
#elif defined(BOARD_LYRAT_ES8388)
    gLive = kLyrat;
#elif defined(BOARD_S3_KORVO2_ES8311)
    gLive = kKorvo;
#else
    gLive = kA1s;
#endif
    if (gLive.detectCodec) boardPrepareCodec(gLive);
    gReady = true;
  }
  return gLive;
}
