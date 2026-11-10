# ESP32-S3 handset

A battery handset for the same lines as the phones. It plays every transmission on the line and has one button for push-to-talk. Speech recognition and translation stay on the server. The handset only sends and plays 12 kHz 16-bit PCM, the same packets the browser uses.

Firmware lives in `firmware/esp32-ptt`. It is split into small modules: Wi-Fi setup, the WebSocket client, the mic, the speaker, the packet codec, the jitter buffer, the button, the floor lease, the battery reading, the LED, and power. The pins and the codec live in `src/boards/`. The rest of the firmware asks that module which board it is.

This was checked with an emulated handset against the server. It has not been flashed onto a real board in this workspace.

## Parts

Prices are approximate street prices in India as of November 2026, from the usual hobby shops. They move around.

| Part | Role | Approx. INR |
| --- | --- | --- |
| Seeed XIAO ESP32-S3, 8 MB PSRAM | Controller | 1,100 |
| INMP441 breakout | I2S microphone | 180 |
| MAX98357A breakout | I2S amplifier | 220 |
| 4 ohm, 3 W speaker | Speaker | 90 |
| TP4056 module with protection | LiPo charger | 50 |
| LiPo cell, about 800 mAh, with a connector | Battery | 350 |
| 100k resistors, two of them | Battery divider | 2 |
| 100 nF capacitor | Divider noise | 2 |
| 1N5819 Schottky diode | Lets USB flashing and the charger share 5 V | 5 |
| Momentary button | Push-to-talk | 10 |
| WS2812, optional | Status LED if you do not use the onboard LED | 20 |
| Wire and a small board | Assembly | 100 |

A working set is about 2,100 INR before a case.

## Wiring

The XIAO pin names are D0, D1, and so on. The GPIO numbers are what the firmware uses.

| XIAO pin | GPIO | Connects to |
| --- | --- | --- |
| D0 | 1 | PTT button, other side to GND. Internal pull-up. Pressed is low. |
| D1 | 2 | MAX98357A BCLK |
| D2 | 3 | MAX98357A LRC |
| D3 | 4 | MAX98357A DIN |
| D4 | 5 | Optional WS2812 DIN, through 330 ohm. Leave open if you use the onboard LED. |
| D5 | 6 | Midpoint of the battery divider |
| D8 | 7 | INMP441 SCK |
| D9 | 8 | INMP441 WS |
| D10 | 9 | INMP441 SD |
| 3V3 |  | INMP441 VDD, MAX98357A VIN |
| GND |  | All grounds, INMP441 L/R, MAX98357A GND and GAIN |
| 5V |  | TP4056 OUT+ through the Schottky, band toward the XIAO |
| GPIO21 | 21 | Onboard LED, active low. No wire. |

INMP441 L/R tied to GND selects the left channel. MAX98357A SD tied to VIN keeps the amp on, and GAIN tied to GND is the lower gain.

Battery divider, from the cell, not from 5V:

```text
cell + ---- 100k ---- GPIO6 ---- 100k ---- GND
                      |
                     100 nF
                      |
                     GND
```

The firmware doubles the ADC reading, so the two resistors must match.

Charger:

```text
LiPo + and -  ->  TP4056 BAT pads
TP4056 OUT+   ->  Schottky anode
Schottky cathode -> XIAO 5V
TP4056 OUT-   ->  XIAO GND
```

Do not also land that cell on the XIAO battery pads. The board has its own charger, and two chargers on one cell is a fault. Charge from the TP4056 USB socket. Flash from the XIAO USB socket. The diode keeps the XIAO's USB 5 V from feeding the charger output.

Diagram: [esp32-wiring.svg](esp32-wiring.svg).

```text
 INMP441          XIAO ESP32-S3         MAX98357A
 SCK ---- D8      D1 ---- BCLK
 WS  ---- D9      D2 ---- LRC
 SD  ---- D10     D3 ---- DIN
 L/R ---- GND     speaker on + / -

 button -- D0 -- GND
 cell -- 100k -- D5 -- 100k -- GND
 TP4056 OUT+ --|>|-- 5V
```

## What the firmware does

Audio on the air is 12 kHz, 16-bit, little-endian PCM. Each packet is `[id length with the high bit set][id][sequence, 4 bytes little-endian][pcm]`, the same layout as `src/lib/packets.ts`. The mic and the amp run at 16 kHz because that is a comfortable I2S rate. The codec resamples to and from 12 kHz. The server does not transcode live audio.

Playback holds about 200 ms, then plays at 1x in sequence order. A late packet waits. It is not stacked on top of audio that is already queued, which is what made phone audio sound fast. A hole longer than the buffer is a gap, not a speed-up.

The floor lease matches the phone fix. While the button is held the handset renews the lease itself every second, for up to 60 seconds. It does not wait for the server to echo that heartbeat. Releasing the button sends a short tail, then a release. The button is ignored until the clock is synced, because a bogus timestamp would win the floor against every phone.

Wi-Fi drops reconnect with a backoff from 1 second up to 30 seconds. A rejected token waits 30 seconds. When nobody is talking and the speaker queue is empty, Wi-Fi uses modem light sleep so the radio can still hear a call. Deep sleep is off unless the setup page asks for it. Deep sleep wakes on the button and misses anything said while it is asleep.

Every 5 seconds the handset publishes presence with battery percent, cell voltage, and Wi-Fi RSSI. The control room shows that next to the handset. The token is stored in flash and is not written to the serial log.

## Board profiles

The handset code does not name a GPIO. `src/boards/profiles.cpp` holds one profile per kit: I2S pins, the codec and its I2C address, the speaker-enable pin, the button, the LED, and the battery divider. `src/boards/board_audio.cpp` starts I2S from that profile and, when the kit has one, writes the ES8388 or ES8311 setup over I2C. A Korvo-2 also starts the ES7210, because that board's microphones are not inside the ES8311.

Pick the kit with the PlatformIO environment:

```sh
cd firmware/esp32-ptt
pio run -e xiao_esp32s3_inmp441_max98357a
pio run -e a1s_es8388
pio run -e lyrat_v43_es8388
pio run -e s3_korvo2_es8311
```

`pio run` with no `-e` builds the XIAO. `pio run -e a1s_es8388 -t upload` flashes that kit.

| Env | Board | Codec | Notes |
| --- | --- | --- | --- |
| `xiao_esp32s3_inmp441_max98357a` | Seeed XIAO ESP32-S3 | none (INMP441 and MAX98357A) | Wiring table above. Battery on GPIO6. |
| `a1s_es8388` | AI-Thinker ESP32-A1S / Audio Kit, ES8388 | ES8388 at I2C `0x10` | MCLK 0, BCLK 27, WS 25, DOUT 26, DIN 35, I2C 33/32, speaker enable GPIO21. KEY1 (GPIO36) is push-to-talk. Uses the 4 MB `huge_app` partition. |
| `lyrat_v43_es8388` | ESP32-LyraT v4.3 | ES8388 at I2C `0x10` | MCLK 0, BCLK 5, WS 25, DOUT 26, DIN 35, I2C 18/23, speaker enable GPIO21. REC (GPIO36) is push-to-talk. Uses the 4 MB `huge_app` partition. |
| `s3_korvo2_es8311` | ESP32-S3-Korvo-2 | ES8311 speaker, ES7210 mics | MCLK 16, BCLK 9, WS 45, DOUT 8, DIN 10, I2C 17/18, speaker enable GPIO48. BOOT (GPIO0) is push-to-talk. |

The A1S and the LyraT use the same codec and a different pin map. That split is why the profile exists: a Boondock Echo kit can be added as another profile and another `[env:...]` block once its model is confirmed. Copy the closest profile, change the pins and the codec, and add `-DBOARD_...` in `platformio.ini`. No other file should need a GPIO change.

These kits have no battery divider on a free ADC pin, so they report signal strength and leave battery blank. The XIAO build still reports the cell.

## Flash

Install [PlatformIO](https://platformio.org/), then, for the XIAO:

```sh
cd firmware/esp32-ptt
pio run -e xiao_esp32s3_inmp441_max98357a -t upload
pio device monitor
```

The XIAO target is `seeed_xiao_esp32s3` with octal PSRAM. Hold the boot button if the upload cannot find the chip. Serial is the USB connector, 115200. The A1S and the LyraT use the classic ESP32 serial port. The Korvo-2 build uses the S3 USB-UART at the same speed.

To use a WS2812 on the XIAO D4 pin instead of the onboard LED, set `ws2812Pin` to `5` and `ledPin` to `-1` in the XIAO profile, then build again.

## Provision

1. In the control room, open the line and choose **Add device**. Copy the device id and the token. The token is shown once. The server keeps a hash.
2. Power the handset. If it has no Wi-Fi saved, it starts an open access point named `Sanket-Setup`.
3. Join that access point from a phone and open `http://192.168.4.1`.
4. Enter the Wi-Fi name and password, the server (`wss://ptt.bowlinger.net/ws` is the default), the line id, the device id, and the token.
5. Leave "Skip certificate check" off. The firmware trusts the Let's Encrypt ISRG Root X1, which is the root for `ptt.bowlinger.net`.
6. Save. The handset restarts and joins the Wi-Fi.

To change the network later, hold the PTT button while it boots, for about 3 seconds. That opens the setup access point again.

The server must be the build that knows about handsets. On the self-hosted machine, rebuild only after you mean to:

```sh
docker build -t sanket-ptt .
docker rm -f sanket-ptt
docker run -d --name sanket-ptt --restart unless-stopped -p 8010:8010 \
  -e PORT=8010 -e HOST=0.0.0.0 \
  -e PUBLIC_HOST=ptt.bowlinger.net -e ADMIN_HOST=pttadmin.bowlinger.net \
  -e DATA_DIR=/data \
  -e DEMO_ORIGINS=https://ptt.bowlinger.net,https://pttadmin.bowlinger.net \
  -e CORS_ORIGINS=https://ptt.bowlinger.net,https://pttadmin.bowlinger.net \
  -e ASR_PROVIDER=transformers -e TRANSLATE_PROVIDER=opus \
  -v /var/lib/sanket-ptt:/data sanket-ptt
```

## Troubleshooting

| What you see | What to check |
| --- | --- |
| LED keeps blinking, serial says the URL is wrong | The server field must start with `wss://` or `ws://`. |
| Serial says the token was not accepted | The id and the token are a pair. A revoked handset will not connect. Add a new device. |
| It connects, then the button does nothing for a few seconds | It is waiting for the clock. It needs DNS and UDP to `pool.ntp.org`. |
| You hear the other phone, but they do not hear you | The line id on the handset must be the line the phone joined. A disabled line rejects the handset. |
| Audio is quiet or missing | INMP441 L/R must be grounded. MAX98357A SD must be at VIN. Confirm D8–D10 and D1–D3. |
| Battery percent is nonsense | The divider must be two equal resistors from the cell to GPIO6. A reading near 0 V means the wire is on the wrong pin. |
| Setup page does not appear | Hold PTT for 3 seconds from the moment power is applied. Join `Sanket-Setup`, then open `http://192.168.4.1`. |
| TLS fails and the site is still Let's Encrypt | Uncheck skip-certificate only after the root in `include/ca_store.h` is ISRG Root X1. A different certificate needs that file updated. |
