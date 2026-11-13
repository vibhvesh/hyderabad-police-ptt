# NodeMCU-32S Arduino sketch

One folder for the Arduino IDE. It joins Wi-Fi, opens `wss://ptt.bowlinger.net/ws`, and speaks the same handset messages as the PlatformIO firmware. There is no setup page.

## Board

Arduino IDE → Boards Manager → install **esp32** by Espressif Systems (2.0.17 or 3.x; this sketch was compiled with **3.2.0**).

| Setting | Value |
| --- | --- |
| Board | NodeMCU-32S |
| Upload speed | 115200 if 921600 never starts |
| Flash size | 4MB |
| Port | the board's USB serial port |

`arduino-cli` FQBN: `esp32:esp32:nodemcu-32s`

## Libraries

Library Manager, exact names:

- **WebSockets** by Markus Sattler (links2004), tested with 2.7.2
- **ArduinoJson** by Benoit Blanchon, tested with 7.4.3

## What to fill in

Open `config.h`. Replace the placeholders. Do not commit a real password or token.

| Name | Where it comes from |
| --- | --- |
| `WIFI_SSID`, `WIFI_PASSWORD` | the handset's Wi-Fi |
| `SERVER_HOST` | leave `ptt.bowlinger.net` unless the server moves |
| `DEVICE_ID` | the id shown with Add device, like `hs1a2b3c` |
| `DEVICE_TOKEN` | the `sdt_...` token shown once on that card |
| `LINE_ID` | the line the handset was added to |

The server answers with the line bound to that token. The sketch uses that answer on the air, and prints a note if `LINE_ID` does not match.

Uncomment `#define LISTEN_ONLY` to play the line with no microphone and no transmit.

## Wiring

Same pins as the `nodemcu-32s` profile. Leave GPIO0, GPIO12, and GPIO15 empty.

| GPIO | Connects to |
| --- | --- |
| 27 | MAX98357A BCLK |
| 14 | MAX98357A LRC |
| 13 | MAX98357A DIN |
| 26 | INMP441 SCK |
| 25 | INMP441 WS |
| 32 | INMP441 SD |
| 4 | PTT button, other side to GND. Pressed is low. |
| 2 | Onboard LED, active low. No wire if the LED is already there. |
| 3V3 | INMP441 VDD and MAX98357A VIN |
| GND | All grounds, INMP441 L/R, MAX98357A GND and GAIN |

Tie MAX98357A SD to VIN so the amp stays on.

## Upload

1. File → Open `arduino-nodemcu32s-ptt.ino`. The other tabs load with it.
2. Select the board and port.
3. Sketch → Upload.
4. Tools → Serial Monitor, **115200**.

If upload sits on Connecting: hold BOOT, tap EN, release BOOT after the upload starts.

## Serial log

A good boot looks like this:

```text
NodeMCU-32S PTT
Wi-Fi connecting to YOUR_WIFI
Wi-Fi connected, IP 192.168.1.20
Waiting for clock
WebSocket connecting to ptt.bowlinger.net:443/ws
WebSocket open, ptt.bowlinger.net:443/ws
Hello sent for hs1a2b3c (token length 36)
Ready on line north as hs1a2b3c
Presence sent
Playing 960 samples from phone01
PTT down
Sending audio
PTT up
```

The password and the token are not printed. `Relay: ...` is the server refusing the hello. Wi-Fi and the socket retry on their own.

The LED blinks slowly with no Wi-Fi, faster while the socket is down, and stays on when the line is up. It blinks quickly while the button is held.
