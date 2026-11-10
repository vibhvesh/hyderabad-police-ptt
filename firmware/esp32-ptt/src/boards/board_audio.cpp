#include "board.h"
#include "pins.h"
#include <Arduino.h>
#include <Wire.h>

static i2s_chan_handle_t gRx = nullptr;
static i2s_chan_handle_t gTx = nullptr;

i2s_chan_handle_t boardMic() { return gRx; }
i2s_chan_handle_t boardAmp() { return gTx; }

int boardRxBits() {
  const BoardI2s &i2s = boardProfile().i2s;
  return i2s.duplex ? i2s.bits : i2s.rxBits;
}

static bool codecWrite(uint8_t addr, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

static void es8388Begin(uint8_t addr) {
  codecWrite(addr, 0x19, 0x04);
  codecWrite(addr, 0x01, 0x50);
  codecWrite(addr, 0x02, 0x00);
  codecWrite(addr, 0x35, 0xA0);
  codecWrite(addr, 0x37, 0xD0);
  codecWrite(addr, 0x39, 0xD0);
  codecWrite(addr, 0x08, 0x00);
  codecWrite(addr, 0x04, 0xC0);
  codecWrite(addr, 0x00, 0x12);
  codecWrite(addr, 0x17, 0x18);
  codecWrite(addr, 0x18, 0x02);
  codecWrite(addr, 0x26, 0x00);
  codecWrite(addr, 0x27, 0x90);
  codecWrite(addr, 0x2A, 0x90);
  codecWrite(addr, 0x2B, 0x80);
  codecWrite(addr, 0x2D, 0x00);
  codecWrite(addr, 0x2E, 0x1E);
  codecWrite(addr, 0x2F, 0x1E);
  codecWrite(addr, 0x30, 0x00);
  codecWrite(addr, 0x31, 0x00);
  codecWrite(addr, 0x15, 0x1E);
  codecWrite(addr, 0x16, 0x1E);
  codecWrite(addr, 0x04, 0x3C);
  codecWrite(addr, 0x03, 0xFF);
  codecWrite(addr, 0x09, 0xBB);
  codecWrite(addr, 0x0A, 0x50);
  codecWrite(addr, 0x0B, 0x02);
  codecWrite(addr, 0x0C, 0x0C);
  codecWrite(addr, 0x0D, 0x02);
  codecWrite(addr, 0x10, 0x00);
  codecWrite(addr, 0x11, 0x00);
  codecWrite(addr, 0x03, 0x09);
  codecWrite(addr, 0x19, 0x00);
  codecWrite(addr, 0x02, 0x00);
}

static void es8311Begin(uint8_t addr) {
  codecWrite(addr, 0x00, 0x1F);
  delay(20);
  codecWrite(addr, 0x00, 0x80);
  codecWrite(addr, 0x01, 0x3F);
  codecWrite(addr, 0x02, 0x00);
  codecWrite(addr, 0x03, 0x10);
  codecWrite(addr, 0x16, 0x24);
  codecWrite(addr, 0x04, 0x10);
  codecWrite(addr, 0x05, 0x00);
  codecWrite(addr, 0x06, 0x07);
  codecWrite(addr, 0x07, 0x00);
  codecWrite(addr, 0x08, 0xFF);
  codecWrite(addr, 0x09, 0x0C);
  codecWrite(addr, 0x0A, 0x0C);
  codecWrite(addr, 0x0B, 0x00);
  codecWrite(addr, 0x0C, 0x00);
  codecWrite(addr, 0x10, 0x1F);
  codecWrite(addr, 0x11, 0x7F);
  codecWrite(addr, 0x00, 0x80);
  codecWrite(addr, 0x0D, 0x01);
  codecWrite(addr, 0x0E, 0x02);
  codecWrite(addr, 0x12, 0x00);
  codecWrite(addr, 0x13, 0x10);
  codecWrite(addr, 0x14, 0x1A);
  codecWrite(addr, 0x17, 0xBF);
  codecWrite(addr, 0x1B, 0x0A);
  codecWrite(addr, 0x1C, 0x6A);
  codecWrite(addr, 0x32, 0xBF);
  codecWrite(addr, 0x37, 0x08);
  codecWrite(addr, 0x44, 0x08);
}

static void es7210Begin(uint8_t addr) {
  codecWrite(addr, 0x00, 0xFF);
  codecWrite(addr, 0x00, 0x41);
  codecWrite(addr, 0x01, 0x3F);
  codecWrite(addr, 0x09, 0x30);
  codecWrite(addr, 0x0A, 0x30);
  codecWrite(addr, 0x23, 0x2A);
  codecWrite(addr, 0x22, 0x0A);
  codecWrite(addr, 0x20, 0x0A);
  codecWrite(addr, 0x21, 0x2A);
  codecWrite(addr, 0x08, 0x00);
  codecWrite(addr, 0x40, 0x43);
  codecWrite(addr, 0x41, 0x70);
  codecWrite(addr, 0x42, 0x70);
  codecWrite(addr, 0x07, 0x20);
  codecWrite(addr, 0x02, 0xC1);
  codecWrite(addr, 0x11, 0x60);
  codecWrite(addr, 0x12, 0x00);
  codecWrite(addr, 0x06, 0x00);
  codecWrite(addr, 0x4B, 0x00);
  codecWrite(addr, 0x4C, 0xFF);
  codecWrite(addr, 0x47, 0x08);
  codecWrite(addr, 0x48, 0x08);
  codecWrite(addr, 0x49, 0xFF);
  codecWrite(addr, 0x4A, 0xFF);
}

static bool openChannel(int port, int bclk, int ws, int dout, int din, int mclk, int bits, bool stereo, i2s_chan_handle_t *tx, i2s_chan_handle_t *rx) {
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG((i2s_port_t)port, I2S_ROLE_MASTER);
  if (i2s_new_channel(&chan, tx, rx) != ESP_OK) return false;
  i2s_std_config_t cfg = {};
  cfg.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(I2S_RATE_HZ);
  i2s_data_bit_width_t width = bits >= 32 ? I2S_DATA_BIT_WIDTH_32BIT : I2S_DATA_BIT_WIDTH_16BIT;
  i2s_slot_mode_t slots = stereo ? I2S_SLOT_MODE_STEREO : I2S_SLOT_MODE_MONO;
  cfg.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(width, slots);
  if (!stereo) cfg.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  cfg.gpio_cfg.mclk = mclk < 0 ? I2S_GPIO_UNUSED : (gpio_num_t)mclk;
  cfg.gpio_cfg.bclk = (gpio_num_t)bclk;
  cfg.gpio_cfg.ws = (gpio_num_t)ws;
  cfg.gpio_cfg.dout = dout < 0 ? I2S_GPIO_UNUSED : (gpio_num_t)dout;
  cfg.gpio_cfg.din = din < 0 ? I2S_GPIO_UNUSED : (gpio_num_t)din;
  if (tx && *tx && i2s_channel_init_std_mode(*tx, &cfg) != ESP_OK) return false;
  if (rx && *rx && i2s_channel_init_std_mode(*rx, &cfg) != ESP_OK) return false;
  if (tx && *tx && i2s_channel_enable(*tx) != ESP_OK) return false;
  if (rx && *rx && i2s_channel_enable(*rx) != ESP_OK) return false;
  return true;
}

bool boardAudioBegin() {
  const BoardProfile &board = boardProfile();
  const BoardI2s &i2s = board.i2s;
  Serial.printf("Board %s\n", board.label);
  bool ok = true;
  if (i2s.duplex) {
    ok = openChannel(i2s.txPort, i2s.bclk, i2s.ws, i2s.dout, i2s.rxDin, i2s.mclk, i2s.bits, true, &gTx, &gRx);
  } else {
    ok = openChannel(i2s.rxPort, i2s.rxBclk, i2s.rxWs, -1, i2s.rxDin, -1, i2s.rxBits, false, nullptr, &gRx);
    ok = openChannel(i2s.txPort, i2s.bclk, i2s.ws, i2s.dout, -1, i2s.mclk, i2s.bits, true, &gTx, nullptr) && ok;
  }
  if (board.i2cSda >= 0 && board.codec != BOARD_CODEC_NONE) {
    Wire.begin(board.i2cSda, board.i2cScl);
    Wire.setClock(100000);
    if (board.codec == BOARD_CODEC_ES8388) es8388Begin(board.codecAddr7);
    if (board.codec == BOARD_CODEC_ES8311) es8311Begin(board.codecAddr7);
    if (board.adc == BOARD_ADC_ES7210) es7210Begin(board.adcAddr7);
  }
  if (board.paPin >= 0) {
    pinMode(board.paPin, OUTPUT);
    digitalWrite(board.paPin, board.paActiveHigh ? LOW : HIGH);
  }
  return ok;
}

void boardSpeaker(bool on) {
  const BoardProfile &board = boardProfile();
  if (board.paPin < 0) return;
  bool level = board.paActiveHigh ? on : !on;
  digitalWrite(board.paPin, level ? HIGH : LOW);
}
