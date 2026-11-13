#pragma once

// Fill these in before upload. Leave the quotes. Do not commit a real
// Wi-Fi password or a real device token.

#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Talk server. wss on port 443, path /ws. No trailing slash.
#define SERVER_HOST "ptt.bowlinger.net"
#define SERVER_PORT 443

// Both values come from the control room "Add device" card. The id looks
// like hs1a2b3c. The token starts with sdt_ and is shown only once.
#define DEVICE_ID "hs000000"
#define DEVICE_TOKEN "sdt_PASTE_THE_TOKEN_HERE"

// The line this handset was added to. The server still answers with the
// line bound to the token; that answer is the one used on the air.
#define LINE_ID "your-line"
#define HANDSET_NAME "NodeMCU-32S"

// Uncomment to play the line only. No microphone is started and the
// button does not transmit.
// #define LISTEN_ONLY

#define PIN_AMP_BCLK 27
#define PIN_AMP_WS 14
#define PIN_AMP_DOUT 13
#define PIN_MIC_BCLK 26
#define PIN_MIC_WS 25
#define PIN_MIC_DIN 32
#define PIN_PTT 4
#define PIN_LED 2

#define SAMPLE_RATE_HZ 12000
#define I2S_RATE_HZ 16000
#define CHUNK_SAMPLES 960
#define PLAYOUT_MS 200
#define FLOOR_HEARTBEAT_MS 1000
#define CLAIM_GRACE_MS 450
#define MAX_HOLD_MS 60000
#define PRESENCE_MS 5000
#define TAIL_MS 350
