#pragma once

// Seeed XIAO ESP32-S3. D0 is GPIO1. The onboard LED is GPIO21, active low.
// Two I2S controllers: the mic receives, the amp transmits. They do not share a clock.

#define PIN_PTT 1
#define PIN_AMP_BCLK 2
#define PIN_AMP_WS 3
#define PIN_AMP_DIN 4
#define PIN_WS2812 5
#define PIN_BATTERY 6
#define PIN_MIC_BCLK 7
#define PIN_MIC_WS 8
#define PIN_MIC_SD 9
#define PIN_LED 21

#define LED_ACTIVE_LOW 1
#define USE_WS2812 0

// The relay and the phones use 12 kHz 16-bit PCM. The mic and the amp run at 16 kHz.
#define SAMPLE_RATE_HZ 12000
#define I2S_RATE_HZ 16000
#define CHUNK_SAMPLES 960
#define PLAYOUT_TARGET_MS 200
#define FLOOR_HEARTBEAT_MS 1000
#define FLOOR_TIMEOUT_MS 2500
#define CLAIM_GRACE_MS 450
#define MAX_HOLD_MS 60000
#define PRESENCE_MS 5000
#define PRE_ROLL_MS 450
#define TAIL_MS 350

#define DEFAULT_SERVER "wss://ptt.bowlinger.net/ws"
