# Sanket PTT

A browser push-to-talk demo and a separate transcription page. One channel is open by default: **SANKET-1**. Hold the button to talk. Only one person speaks at a time.

**Demo only, not for professional use.**

Sanket Transcribe is the second page. It records from the microphone or an audio file, shows the original text, and shows a translation only when a translator is actually available.

The Reference page is where an administrator files updates and a designated commander approves them. Ordinary radio audio never edits that file.

The control room is a separate monitoring screen. It has no push-to-talk button. Phones keep using the Talk page. The server transcribes and translates each clip and pushes the text back over the WebSocket. The Talk page does not download Whisper or a translation model.

## Control room

On one host, including the Render demo, open `/#/control`. On the self-hosted pair, Talk is `https://ptt.bowlinger.net` and the control room is `https://pttadmin.bowlinger.net`. Both names reach the same process. Set `PUBLIC_HOST` and `ADMIN_HOST` together. If either is empty, every route stays on the one host and the control room remains `/#/control`.

The talk hostname serves the Talk page, `/api/lines`, `/health`, and `/ws`. Control APIs and the demo-code login return 404 there. The admin hostname serves the control room and its APIs. Its WebSocket is closed so that hostname is not a second radio. The admin cookie is host-only (`SameSite=Lax`, no `Domain`), so a Talk browser does not send it.

Sign in with `ADMIN_TOKEN` or the shared demo code. From the console you can:

- Create, rename, enable, disable, and delete lines. Each line has a join link and a QR code that opens Talk on that line.
- Add a handset to a line. The token is shown once. The server stores only its hash. Revoke it from the same screen. Battery, signal, and online state show on the handset row. The default firmware is the AI-Thinker ESP32-A1S Audio Kit used by Boondock. `nodemcu-32s` is the ESP32 DevKit build. An ESP8266 NodeMCU cannot run it. See [docs/esp32-device.md](docs/esp32-device.md).
- Watch who is online, the current floor, and a short activity feed.
- Read the communication log in India Standard Time, filter it, play the stored clip, and export CSV or TXT.
- Choose the speech recognizer, English/Hindi translation, clip retention, and an optional ElevenLabs Scribe key. The key is stored in `DATA_DIR` and is not returned to the browser. Scribe runs only after local recognition fails, and it does not translate. Telugu text is kept as spoken and is not guessed into another language.
- Open the Reference review screen.

Lines, settings, and handset records are files under `DATA_DIR` (`console/lines.json`, `console/settings.json`, `console/devices.json`). A handset record stores a hash of the token, not the token. Clips and audio are under `DATA_DIR/radio`. The default retention is 14 days. Handset audio uses the same 12 kHz packets as a phone, so the server log and the transcript path are the same.

Self-hosted rebuild, with the process listening on port 8010 for the tunnel:

```sh
docker build -t sanket-ptt .
docker rm -f sanket-ptt
docker run -d --name sanket-ptt --restart unless-stopped -p 8010:8010 \
  -e PORT=8010 \
  -e HOST=0.0.0.0 \
  -e PUBLIC_HOST=ptt.bowlinger.net \
  -e ADMIN_HOST=pttadmin.bowlinger.net \
  -e DATA_DIR=/data \
  -e DEMO_ORIGINS=https://ptt.bowlinger.net,https://pttadmin.bowlinger.net \
  -e CORS_ORIGINS=https://ptt.bowlinger.net,https://pttadmin.bowlinger.net \
  -e ASR_PROVIDER=transformers \
  -e TRANSLATE_PROVIDER=opus \
  -v /var/lib/sanket-ptt:/data \
  sanket-ptt
```

Cloudflare Tunnel ingress, both names to that same port:

```yaml
ingress:
  - hostname: ptt.bowlinger.net
    service: http://127.0.0.1:8010
  - hostname: pttadmin.bowlinger.net
    service: http://127.0.0.1:8010
  - service: http_status:404
```

For local recognition on that server, install the image as written and set the two providers above. The first clip downloads Whisper tiny and the English-Hindi OPUS models into `MODEL_DIR` inside the data volume. The free Render service does not run those models; its control room can still manage lines, and transcripts stay "recognition is off" until a provider is selected on a machine that can run them.

## Run the browser app

```sh
npm install
npm test
npm run dev
```

Open http://127.0.0.1:8731/hyderabad-police-ptt/ . The dev server proxies `/api`, `/health`, and `/ws` to a local server on port 8080 when that server is running. Without it, Talk still uses the public MQTT relays.

```sh
npm run server
```

The server listens on `0.0.0.0:8080` unless `HOST` and `PORT` are set. Copy `.env.example` to `.env` and set the tokens before using Reference, transcription upload, or webhooks. Empty tokens make those actions return "not configured".

`npm run build` writes the GitHub Pages build under `/hyderabad-police-ptt/`. `npm run build:root` writes a site for the Pi or the container at `/`.

## What was checked in this workspace

| Check | Result |
| --- | --- |
| `npm test` | 60 tests passed, 2 live-provider files skipped. Includes line management, host split, the caption queue, and the unconfigured recognizer. |
| Public MQTT | HiveMQ, EMQX, and Shiftr accepted an isolated diagnostic topic from this machine. `test.mosquitto.org:8081` closed the socket, so it is not in the default list. |
| Two browsers on the public demo channel | Not run. Tests use an in-memory channel. |
| Local Whisper, OPUS translation, espeak-ng | Run with `LIVE_PROVIDERS=1 npx vitest run tests/live/providers.test.ts`. The default `npm test` skips that file and uses mocks only for the service tests. |
| Raspberry Pi hardware | Not available. The installer and container file are in the repo and were not executed on a Pi. |
| Docker image build | Not run. Docker is not installed in this workspace. The Dockerfile uses `node:22-bookworm-slim`, which publishes arm64 and amd64 images. |
| Production deploy | Not done. |

## Server environment

Names and empty defaults are in `.env.example`.

| Name | Purpose |
| --- | --- |
| `ADMIN_TOKEN` | File drafts, name the commander, set dates, add a fetch source |
| `REVIEWER_TOKEN` | Promote or reject a draft, approve the same text again |
| `INGEST_TOKEN` | Ask the approved file, upload a radio clip, request translation |
| `WEBHOOK_SECRET` or `WEBHOOK_TOKEN` | Sign or authorize `POST /api/ingest/webhook` |
| `ASR_PROVIDER` | `none` (default), `transformers` (local Whisper tiny), `whisper-cli`, or `mock` |
| `TRANSLATE_PROVIDER` | `none` (default), `opus` (local English, Hindi, and Telugu), `libre`, or `mymemory` |
| `TTS_PROVIDER` | `none` (default), `espeak`, or `mock` |
| `MODEL_DIR` | Where Whisper and OPUS files are stored. Default `data/models` |
| `TLS_CERT` and `TLS_KEY` | HTTPS. Required for phone microphones that are not on localhost |
| `AUDIO_INPUT` and `AUDIO_OUTPUT` | Optional ALSA names for a Pi radio device |

`GET /health` reports provider mode, whether tokens are configured, and that no mailbox is connected. It does not include token values or the reference file.

Local speech, translation, and spoken replies:

```sh
sudo apt-get install -y espeak-ng
ASR_PROVIDER=transformers TRANSLATE_PROVIDER=opus TTS_PROVIDER=espeak MODEL_DIR=./data/models npm run server
```

The first clip and the first translation download the models into `MODEL_DIR`. English and Hindi translation use `Xenova/opus-mt-en-hi` and `Xenova/opus-mt-hi-en`. Telugu speech recognition and the espeak-ng `te` voice work. Telugu translation is refused: the multilingual OPUS file splits its Telugu language token in this runtime, and the server does not return that broken string. `npm test` does not download the models. Its server cases use the mock recognizer or the unconfigured state. The live check is `LIVE_PROVIDERS=1 npx vitest run tests/live/providers.test.ts`.

There is no built-in review interval. Leave review due and valid until empty, or set an exact time. A draft does not move those times.

## Raspberry Pi

See [deploy/pi/QUICKSTART.md](deploy/pi/QUICKSTART.md). Phones on the LAN need HTTPS. The installer can write a local certificate. Trust it on the phone or the microphone stays blocked.

## Container

```sh
docker build -t sanket-ptt .
docker compose up
```

That build was not run here. Compose reads `.env` and does not start a translator container.

## Legacy channel

The default line is `sanket-ptt/v1/sanket-1/`. The control room can add more lines under `sanket-ptt/v1/<line-id>/`. A join link looks like `https://ptt.bowlinger.net/#/?line=north-1`. The previous public demo topic `hyd-police-ptt/demo1/hyd-1/` is still an allowed relay prefix. Audio framing is unchanged. The Android file in `releases/` is an old WebView shell and is not required.
