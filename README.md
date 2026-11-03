# Hyderabad City Police – PTT Demo

**Demo only – not for professional or operational use.**

A small push-to-talk demo. The page is one HTML file. Voice and floor control go over a public MQTT broker, the same shape as [sanketptt](https://github.com/vibhvesh/sanketptt). A short Node program only serves that page and turns audio into text. There is no PIN. Anyone with the link joins.

The shield marked **HCP** is a placeholder, not an official insignia.

## Run

```bash
node server.js
```

Open http://127.0.0.1:43124 . Type a call sign, press Join, pick a talkgroup, and hold the button (or the spacebar). Telugu is the default transcription language. English and Hindi are in the same list.

Public page, while this machine’s tunnel is up: https://hist-image-success-polyester.trycloudflare.com

`node --test test.js` checks floor control, pre-roll, the release tail, and that the page has no PIN.

## Speech

| Language | Provider |
| --- | --- |
| Telugu (default) | AI4Bharat IndicConformer `ai4bharat/indicconformer_stt_te_hybrid_rnnt_large` when `INDIC_CONFORMER_URL` is set |
| English | Google Cloud Speech-to-Text (`en-IN`) when `GOOGLE_SPEECH_API_KEY` is set |
| Hindi | Google Cloud Speech-to-Text (`hi-IN`) |
| Any | ElevenLabs Scribe when `ELEVENLABS_API_KEY` is set and that language’s provider is `elevenlabs` |

Copy `.env.example` to `.env`. With nothing set, history shows a labeled sample line, not a recognition result. IndicConformer was chosen because it is a free MIT Telugu model. Stock Whisper is weak on Telugu. The optional sidecar is `scripts/indic_conformer_server.py`.

## What this keeps from the radio

* One talker at a time (a short claim race, then the floor drops if the talker vanishes).
* About 280 ms of audio from before the press is sent when the floor is granted, so the first syllable is not cut off.
* Audio continues for about 250 ms after release.
* The relay reconnects, and tries the next public broker if the first one fails.
* The first tap resumes the audio context so iOS can play sound.

## Raspberry Pi 5

Wire BCM GPIO 17 (pin 11) to ground (pin 6). Plug in a USB headset. Then:

```bash
sudo bash pi/install.sh
```

The service starts on boot and restarts if it crashes. It joins the same MQTT channel as the web page. Set `PTT_HTTP` in `/etc/hcp-ptt.env` to the demo origin if that Pi should request transcripts.

## Android

```bash
android/build.sh demo.hyderabadpolice.ptt "HCP PTT Demo" https://vibhvesh.github.io/hyderabad-police-ptt/ "#0C2340" releases/HyderabadPolicePTT.apk
```

The APK is a WebView with microphone permission. Install with `adb install -r releases/HyderabadPolicePTT.apk`.

## Layout

```
index.html     the radio (UI + MQTT protocol)
server.js      static file + speech-to-text
test.js        protocol tests
pi/            Pi 5 edge node
android/       tiny WebView APK build
```
