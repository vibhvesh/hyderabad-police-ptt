# Hyderabad Police PTT

A one-channel push-to-talk demo. Open the page and you are on channel **HYD-1**. Hold the button to talk. Only one person can talk at a time.

**Demo only, not for professional use.**

## Public demo

https://vibhvesh.github.io/hyderabad-police-ptt/

The Android app loads that address.

## Run it locally

```bash
npm install
npm test
npm run dev
```

The dev server listens on http://127.0.0.1:8731. `npm run build` then `npm run preview` serves the production build on the same port.

Microphone, speaker, and location prompts come from the browser. There is no PIN and no account. A unit name is created on this device and can be changed in settings.

## How a call works

Voice is 12 kHz 16-bit PCM over a public MQTT WebSocket broker (HiveMQ, then EMQX, Mosquitto, and Shiftr as fallbacks). The page reconnects on its own. A short pre-roll and a short tail are kept so the first and last syllables are not clipped. The first tap unlocks audio for iOS.

Each transmission is listed with playback, a transcript, and the sender’s latitude, longitude, and accuracy. There is no map.

Transcription language defaults to Telugu. English and Hindi are on the main screen. On-device Whisper (`onnx-community/whisper-base`, quantised) downloads once and is cached in the browser. Settings can switch a device to ElevenLabs Scribe; the API key stays in `localStorage` and audio is sent to ElevenLabs only when that option is selected.

## Android wrapper

`releases/HyderabadPolicePTT.apk` is a thin WebView shell. It requests microphone and location, then opens the public demo. Install it with “install unknown apps” enabled. Rebuild after the public address changes:

```bash
android/build.sh in.hyderabad.police.ptt "Hyderabad Police PTT" "https://your-host/" releases/HyderabadPolicePTT.apk
```

The script expects Android SDK platform 34 and build-tools 34.0.0 (`ANDROID_HOME`, default `$HOME/android-sdk`). The demo signing key is created at `android/debug.keystore` (password `hydptt123`) and is not committed.
