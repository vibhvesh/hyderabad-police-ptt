#pragma once

enum LedMode { LED_SETUP, LED_CONNECTING, LED_ONLINE, LED_TALK, LED_LISTEN, LED_ERROR };

void ledBegin();
void ledSet(LedMode mode);
void ledTick(unsigned long nowMs);
