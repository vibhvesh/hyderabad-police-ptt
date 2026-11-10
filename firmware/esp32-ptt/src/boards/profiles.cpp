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
};

// AI-Thinker ESP32-A1S / Audio Kit, ES8388 build (the 2974 and 3378 modules).
// I2C is GPIO33/32, not the LyraT's 18/23. Onboard mics use the codec ADC.
static const BoardProfile kA1s = {
  "a1s_es8388",
  "AI-Thinker ESP32-A1S Audio Kit, ES8388",
  {0, 27, 25, 26, 0, 16, true, 0, 27, 25, 35, 16},
  BOARD_CODEC_ES8388,
  BOARD_ADC_SAME,
  33, 32, 0x10, 0,
  21, true,
  36, true, false,
  22, false,
  -1,
  -1, 2.f, 3.30f, 4.20f,
};

// ESP32-LyraT v4.3. Same codec as the A1S, different I2S and I2C pins.
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
};

// ESP32-S3-Korvo-2. The speaker codec is an ES8311. The microphones are an ES7210 on the same I2S bus.
// BOOT (GPIO0) is the direct button. The other keys sit on an IO expander.
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
};

const BoardProfile &boardProfile() {
#if defined(BOARD_A1S_ES8388)
  return kA1s;
#elif defined(BOARD_LYRAT_ES8388)
  return kLyrat;
#elif defined(BOARD_S3_KORVO2_ES8311)
  return kKorvo;
#else
  return kXiao;
#endif
}
