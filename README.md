# Sanket PTT

A browser push-to-talk demo and a separate transcription page. One channel is open by default: **SANKET-1**. Hold the button to talk. Only one person speaks at a time.

**Demo only, not for professional use.**

Sanket Transcribe is the second page. It records from the microphone or an audio file, shows the original text, and shows a translation only when a translator is actually available.

The Reference page is where an administrator files updates and a designated commander approves them. Ordinary radio audio never edits that file.

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
| `npm test` | 35 tests passed. Floor control, isolated in-memory audio, approval, forwards, expiry, SSRF, webhook signature, and the unconfigured recognizer. |
| Public MQTT | HiveMQ, EMQX, and Shiftr accepted an isolated diagnostic topic from this machine. `test.mosquitto.org:8081` closed the socket, so it is not in the default list. |
| Two browsers on the public demo channel | Not run. Tests use an in-memory channel. |
| Whisper model download | Not run. The page says the model downloads on first use. |
| espeak / whisper-cli | Not installed here. Health reports them unconfigured unless you set them. |
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
| `ASR_PROVIDER` | `none` (default), `whisper-cli`, or `mock` |
| `TRANSLATE_PROVIDER` | `none` (default), `libre`, or `mymemory` |
| `TTS_PROVIDER` | `none` (default), `espeak`, or `mock` |
| `TLS_CERT` and `TLS_KEY` | HTTPS. Required for phone microphones that are not on localhost |
| `AUDIO_INPUT` and `AUDIO_OUTPUT` | Optional ALSA names for a Pi radio device |

`GET /health` reports provider mode, whether tokens are configured, and that no mailbox is connected. It does not include token values or the reference file.

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

Settings still default to `sanket-ptt/v1/sanket-1/`. The previous public demo topic `hyd-police-ptt/demo1/hyd-1/` can be typed as the topic root. Audio framing is unchanged, so an older page can still hear a newer one on the same topic. The Android file in `releases/` is an old WebView shell and is not required.
