#pragma once

// Timing shared by every board. Pins live in the board profile.

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
