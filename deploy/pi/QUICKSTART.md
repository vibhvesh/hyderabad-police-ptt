# Sanket on a Raspberry Pi

This is the same web app. The Pi runs the server and serves the pages. Phones join over the local network. No APK is required.

This checkout was not run on a physical Raspberry Pi. The steps below are the installer and the limits we can state without that hardware.

## What you need

- Raspberry Pi OS 64-bit. Pi 5 is the primary target. Pi 3 can run the same image with the lighter settings below. A 32-bit operating system is outside this installer.
- Node.js 22 or newer.
- A 5V power supply that meets the Pi's own requirement. A Pi 5 needs its official 27W supply when USB audio is attached. A Pi 3 needs a supply that can hold 5V under load. This app does not measure that.
- Disk: about 1 GB for Node modules, plus model files if you enable server speech recognition. The browser can also download its own Whisper model onto each phone.

## Install

From a checkout of this repository, on the Pi:

```sh
sh deploy/pi/install.sh
sudoedit /etc/sanket-ptt.env
sudo systemctl enable --now sanket-ptt
```

Set `ADMIN_TOKEN`, `REVIEWER_TOKEN`, and `INGEST_TOKEN` in `/etc/sanket-ptt.env`. Leave them empty and the matching button returns "not configured".

The installer writes a local HTTPS certificate. Phones must open `https://` and trust that certificate. `http://` on the LAN is not a secure page, so the phone browser will not provide the microphone. The Pi's own desktop browser can use `http://localhost` or `https://localhost`.

Health check, from the Pi:

```sh
curl -k https://127.0.0.1:8443/health
```

The JSON names the speech, translation, and speech-synthesis providers. `unconfigured` means that part is off. The service does not invent a transcript or a spoken reply.

## Pi 5 and Pi 3

`PI_PROFILE=pi5` is the default note in the health output. For a Pi 3 set `PI_PROFILE=pi3`. This repository does not claim a realtime speed on either board.

Local providers, after `sudo apt-get install -y espeak-ng`:

```sh
ASR_PROVIDER=transformers
TRANSLATE_PROVIDER=opus
TTS_PROVIDER=espeak
ASR_MODEL=onnx-community/whisper-tiny
MODEL_DIR=/var/lib/sanket-ptt/models
```

Put those lines in `/etc/sanket-ptt.env`. The first request downloads the files into `MODEL_DIR`.

| Piece | Download | Memory while running | Pi 5 (4 GB or more) | Pi 3 (1 GB) |
| --- | --- | --- | --- | --- |
| Whisper tiny, quantized | about 150 MB | about 1 GB | Use this | Use this, and do not load a translation model at the same time |
| OPUS English-Hindi pair, quantized | about 200 MB for the files that are actually loaded | about 1 GB for one model | English and Hindi. Telugu translation stays off | Leave `TRANSLATE_PROVIDER=none` unless the board has swap and you accept long pauses |
| espeak-ng | a few MB | negligible | English, Hindi, and Telugu voices | Same |

Whisper base and the 600M NLLB model are not the defaults. They are larger than this Pi 3 guidance. Phones can still use the on-device Whisper model in the browser after that phone has downloaded it once. `mymemory` needs the internet and is not for sensitive text.

`AUDIO_INPUT` and `AUDIO_OUTPUT` take ALSA names such as `plughw:1,0`. Leave them empty when the microphones and speakers are the phones. This build does not start a local capture loop unless those names are set, and capture was not exercised on hardware here.

## Models and offline use

- Browser Whisper downloads when someone transcribes on a phone. After that, recognition works on that phone without the network.
- `ASR_PROVIDER=none` is the default. The server then refuses server transcription instead of returning made-up text.
- No review interval is installed. Set a review due date or a valid-until time in the Reference page, or leave both empty.

## Autostart

`systemctl enable --now sanket-ptt` starts the service at boot and restarts it if the process exits. Logs: `journalctl -u sanket-ptt`.

The public MQTT brokers are not used when phones open the Pi's own site. The page finds `/health` on that site and uses the local relay.
