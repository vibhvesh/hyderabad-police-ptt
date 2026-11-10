#pragma once

#include <driver/i2s_std.h>
#include <stdint.h>

// One board profile. Audio, the button, the LED, and the battery all read this.
// A new kit is a new profile plus a PlatformIO env. Nothing else should mention a GPIO.

enum BoardCodec : uint8_t {
  BOARD_CODEC_NONE = 0,
  BOARD_CODEC_ES8388 = 1,
  BOARD_CODEC_ES8311 = 2,
  BOARD_CODEC_AC101 = 3,
};

enum BoardAdc : uint8_t {
  BOARD_ADC_NONE = 0,
  BOARD_ADC_SAME = 1,
  BOARD_ADC_ES7210 = 2,
};

struct BoardI2s {
  int txPort;
  int bclk;
  int ws;
  int dout;
  int mclk;
  int bits;
  bool duplex;
  int rxPort;
  int rxBclk;
  int rxWs;
  int rxDin;
  int rxBits;
};

struct BoardProfile {
  const char *id;
  const char *label;
  BoardI2s i2s;
  BoardCodec codec;
  BoardAdc adc;
  int i2cSda;
  int i2cScl;
  uint8_t codecAddr7;
  uint8_t adcAddr7;
  int paPin;
  bool paActiveHigh;
  int buttonPin;
  bool buttonActiveLow;
  bool buttonPullup;
  int ledPin;
  bool ledActiveLow;
  int ws2812Pin;
  int batteryPin;
  float batteryScale;
  float batteryEmpty;
  float batteryFull;
  int extPttPin;
  int extraPttPin;
  int setupPin;
  int headphonePin;
  bool detectCodec;
  int volDownPin;
  int volUpPin;
};

const BoardProfile &boardProfile();
void boardPrepareCodec(BoardProfile &board);
bool boardAudioBegin();
void boardSpeaker(bool on);
bool boardHeadphoneInserted();
i2s_chan_handle_t boardMic();
i2s_chan_handle_t boardAmp();
int boardRxBits();
