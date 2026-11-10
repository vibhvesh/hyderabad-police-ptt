# ESP32-S3 handset

A battery handset for the same lines as the phones. It plays every transmission on the line and has one button for push-to-talk. Speech recognition and translation stay on the server. The handset only sends and plays 12 kHz 16-bit PCM, the same packets the browser uses.

Firmware lives in `firmware/esp32-ptt`. It is split into small modules: Wi-Fi setup, the WebSocket client, the mic, the speaker, the packet codec, the jitter buffer, the button, the floor lease, the battery reading, the LED, and power. The pins and the codec live in `src/boards/`. The default board is the AI-Thinker ESP32-A1S Audio Kit, which is the board in the Boondock Echo kit. The XIAO build is the other one.

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

## Boondock kit: ESP32-A1S Audio Kit

This is a classic ESP32, not an ESP32-S3. The module on the board has 4 MB of flash and 8 MB of PSRAM. The firmware env is `esp32-a1s`, and `pio run` with no `-e` builds that env. It uses the onboard microphones, the onboard speaker amplifier, the green LED on GPIO22, and the keys.

At boot the firmware probes I2C and picks the codec that answers:

| What answers | Pins it uses |
| --- | --- |
| ES8388 at `0x10` on SDA 33 / SCL 32 | BCLK 27, WS 25, data out 26, data in 35. The common Audio Kit. |
| ES8388 at `0x10` on SDA 18 / SCL 23 | BCLK 5, WS 25, data out 26, data in 35. The other ES8388 revision. |
| AC101 at `0x1A` on SDA 33 / SCL 32 | BCLK 27, WS 26, data out 25, data in 35. Older boards, silkscreen 2379. |

If nothing answers, it keeps the first ES8388 map and says so on the serial port. Serial does not print the device token.

The speaker amplifier is GPIO21, driven high only while audio is playing. Plugging in headphones pulls the detect pin low and the amplifier stays off, so the sound comes out of the jack instead of the speaker. On the ES8388 boards that pin is GPIO39. On the AC101 board it is GPIO5.

Keys, all active low:

| Key | GPIO | What it does |
| --- | --- | --- |
| KEY1 | 36 | Onboard push-to-talk. This pin has no pull-up, so press it firmly. |
| KEY3, and header pin IO19 | 19 | The same net. Wire a large external button between header IO19 and GND. |
| KEY6 | 5 | Also push-to-talk on ES8388 boards. On an AC101 board this pin is the headphone switch, so it is not a key. |
| KEY2 | 13 | Not used. Only present when the DIP switch connects it. |
| KEY4, KEY5 | 23, 18 | Not used. On the second ES8388 revision those pins are the I2C bus. |

Hold KEY3, or the external button on IO19, for about 3 seconds from power-up to open the setup access point.

The board charges a 3.7 V LiPo from its battery connector, but the V2.2 schematic does not route the cell to an ADC pin. GPIO34 is free and is an ADC input. If you add two 100k resistors, one from the cell positive to GPIO34 and one from GPIO34 to ground, the firmware reports the cell. A floating GPIO34 wanders, and those readings are ignored, so an unmodified kit leaves battery blank and still reports Wi-Fi signal.

### DIP switch

The five-position switch next to the SD card chooses what GPIO13 and GPIO15 connect to. This firmware does not use the SD card. Set it like this:

| Position | Label | Setting | Why |
| --- | --- | --- | --- |
| 1 | IO13 to KEY2 | ON | KEY2 is available if you want it. |
| 2 | IO13 to SD DATA3 | OFF | The SD card must not fight GPIO13. |
| 3 | IO15 to SD CMD | OFF | GPIO15 is a boot strap. Leave it off the SD card. |
| 4 | IO13 to JTAG MTCK | OFF | JTAG must not fight GPIO13. |
| 5 | IO15 to JTAG MTDO | OFF | Leave GPIO15 alone at boot. |

Do not turn on both position 1 and position 2. Do not turn on position 3 or 5 while flashing.

### Flashing the Audio Kit

The USB chip is a serial adapter on a classic ESP32. GPIO0 is also the codec's master clock, so auto-reset sometimes misses download mode.

```sh
cd firmware/esp32-ptt
pio run -e esp32-a1s -t upload
pio device monitor
```

Upload runs at 115200. Close the monitor before uploading. If the tool sits on "Connecting" or "Failed to connect":

1. Hold the header pin IO0 to GND.
2. Tap the RST pin to GND, or press the reset button if the board has one.
3. Release IO0 after the upload starts.

If it still fails, unplug the headphones and the speaker, then try again. The codec can load GPIO0.

## NodeMCU-32S

This is the ESP32 DevKit sold as NodeMCU-32S, with an ESP32-WROOM-32. It has 4 MB of flash and no PSRAM. The jitter buffer uses internal RAM, which is enough for 12 kHz. Build it with `pio run -e nodemcu-32s`. The mic and the amp are the same parts as the XIAO, on two separate I2S ports.

| GPIO | Connects to |
| --- | --- |
| 26 | INMP441 SCK |
| 25 | INMP441 WS |
| 32 | INMP441 SD |
| 27 | MAX98357A BCLK |
| 14 | MAX98357A LRC |
| 13 | MAX98357A DIN |
| 4 | Push-to-talk button, other side to GND. Internal pull-up. Pressed is low. |
| 2 | Onboard LED, active low. No wire unless that LED is missing. |
| 34 | Midpoint of the battery divider. Input only. |
| 3V3 | INMP441 VDD and MAX98357A VIN |
| GND | All grounds, INMP441 L/R, MAX98357A GND and GAIN |
| VIN | TP4056 OUT+ through a Schottky diode, band toward the board |

Tie MAX98357A SD to VIN so the amp stays on. Tie GAIN to GND for the lower gain. GPIO34 cannot drive a pin, so the battery wire is sense only:

```text
cell + ---- 100k ---- GPIO34 ---- 100k ---- GND
                       |
                      100 nF
                       |
                      GND
```

The two resistors must match. The firmware doubles the ADC reading. GPIO34 is on ADC1, so Wi-Fi does not steal the measurement.

```text
LiPo + and -   ->  TP4056 BAT pads
TP4056 OUT+    ->  Schottky anode
Schottky cathode -> NodeMCU VIN
TP4056 OUT-    ->  GND
```

Charge from the TP4056 USB socket. Flash from the NodeMCU USB socket. The diode keeps the board's 5 V from feeding the charger output.

Diagram: [nodemcu-32s-wiring.svg](nodemcu-32s-wiring.svg).

```sh
cd firmware/esp32-ptt
pio run -e nodemcu-32s -t upload
pio device monitor
```

Hold BOOT, tap EN, and release BOOT if the upload does not start. Leave GPIO0, GPIO12, and GPIO15 unwired. Those pins decide the boot mode.

Hold the GPIO4 button for about 3 seconds from power-up to open the setup page.

### ESP8266 NodeMCU is not supported

The older NodeMCU v2 and v3 boards use an ESP8266. This firmware does not build for them.

The ESP8266 I2S block can play audio out. It has no I2S input, so an INMP441 cannot be read as a microphone. Bit-banging the mic drops samples and still leaves no second clock for the amplifier. The chip has about 80 KB of RAM. After Wi-Fi, what remains is too small for a TLS WebSocket, the certificate check, and a jitter buffer at the same time. A build that connected and then stuttered or reset would look like a working handset and would not be one.

Use a NodeMCU-32S for this wiring. The env name is `nodemcu-32s`.

## Other boards

The XIAO, the LyraT v4.3, and the ESP32-S3-Korvo-2 are still in `src/boards/profiles.cpp`. Build one of those with `-e`:

```sh
pio run -e xiao_esp32s3_inmp441_max98357a
pio run -e lyrat_v43_es8388
pio run -e s3_korvo2_es8311
```

| Env | Board |
| --- | --- |
| `esp32-a1s` | AI-Thinker ESP32-A1S Audio Kit. Default. Classic ESP32, 4 MB flash, 8 MB PSRAM. |
| `nodemcu-32s` | NodeMCU-32S with an INMP441, a MAX98357A, a button, the onboard LED, and a battery divider on GPIO34. |
| `xiao_esp32s3_inmp441_max98357a` | Seeed XIAO ESP32-S3 with the INMP441 and MAX98357A wired above. |
| `lyrat_v43_es8388` | ESP32-LyraT v4.3, ES8388, I2C 18/23, BCLK 5. |
| `s3_korvo2_es8311` | ESP32-S3-Korvo-2. ES8311 speaker, ES7210 mics. BOOT is push-to-talk. |

The XIAO upload is `pio run -e xiao_esp32s3_inmp441_max98357a -t upload`. Hold its boot button if the upload cannot find the chip. To use a WS2812 on XIAO D4 instead of the onboard LED, set `ws2812Pin` to `5` and `ledPin` to `-1` in that profile.

## Provision

1. In the control room, open the line and choose **Add device**. Copy the device id and the token. The token is shown once. The server keeps a hash.
2. Power the handset. If it has no Wi-Fi saved, it starts an open access point named `Sanket-Setup`.
3. Join that access point from a phone and open `http://192.168.4.1`.
4. Enter the Wi-Fi name and password, the server (`wss://ptt.bowlinger.net/ws` is the default), the line id, the device id, and the token.
5. Leave "Skip certificate check" off. The firmware trusts the Let's Encrypt ISRG Root X1, which is the root for `ptt.bowlinger.net`.
6. Save. The handset restarts and joins the Wi-Fi.

To change the network later, hold the push-to-talk button while it boots, for about 3 seconds. On the Audio Kit that is KEY3 or the button on header IO19. On the NodeMCU-32S it is the button on GPIO4. That opens the setup access point again.

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
| Audio is quiet or missing on the XIAO | INMP441 L/R must be grounded. MAX98357A SD must be at VIN. Confirm D8–D10 and D1–D3. |
| The Audio Kit says the codec was not found | Power the board from the USB port, then read the serial line. An ES8388 answers at I2C `0x10`. An AC101 answers at `0x1A`. |
| The speaker stays quiet and headphones work | A plugged-in jack mutes the amplifier on purpose. Unplug the jack. |
| The XIAO battery percent is nonsense | The divider must be two equal resistors from the cell to GPIO6. |
| The Audio Kit battery stays blank | The stock board does not wire the cell to an ADC. Add the 100k/100k divider to GPIO34. |
| Setup page does not appear | On the Audio Kit, hold KEY3 or the IO19 button for 3 seconds from power-up. On the NodeMCU-32S or the XIAO, hold the push-to-talk button the same way. Join `Sanket-Setup`, then open `http://192.168.4.1`. |
| NodeMCU upload never starts | Hold BOOT, tap EN, release BOOT. The env is `nodemcu-32s`. An ESP8266 NodeMCU cannot run this firmware. |
| Upload to the Audio Kit never connects | Hold IO0 to ground, tap reset, then release IO0. Use `pio run -e esp32-a1s -t upload`. |
| TLS fails and the site is still Let's Encrypt | Uncheck skip-certificate only after the root in `include/ca_store.h` is ISRG Root X1. A different certificate needs that file updated. |
