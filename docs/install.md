# Install Sanket PTT v2

One command, on Raspberry Pi OS 64-bit / Ubuntu arm64 (Pi 4 or 5) or on Ubuntu/Debian x86_64:

```sh
curl -fsSL https://raw.githubusercontent.com/vibhvesh/hyderabad-police-ptt/main/install.sh | sudo bash
```

The script:

1. Reads the machine architecture (`aarch64` or `x86_64`).
2. Installs Docker when it is missing, and enables it when systemd is present.
3. Clones this repository to `/opt/sanket-ptt` when you did not already have it.
4. Writes `.env` with generated tokens and empty provider keys. It does not print the Wi-Fi or speech keys. It does print the new admin token once, because that is how you sign in.
5. Builds the image for the architecture it is running on and starts it with `restart: unless-stopped`.
6. Prints the client URL and the admin URL.

The image starts from `node:22-bookworm-slim`, which is published for both `linux/amd64` and `linux/arm64`. Packages in the Dockerfile (`ca-certificates`, `espeak-ng`, `openssl`) exist on both.

## Hostnames

```sh
curl -fsSL https://raw.githubusercontent.com/vibhvesh/hyderabad-police-ptt/main/install.sh | sudo env CLIENT_HOST=talk.example.com ADMIN_HOST=admin.example.com bash
```

Leave both empty to use one host: the talk app is `/#/` and the control room is `/#/control`.

## Raspberry Pi

`ASR_PROVIDER` is set to `none`. The Pi does not download Whisper. After you open the admin URL, go to Settings and choose ElevenLabs, OpenAI, Google, Azure Speech, or Deepgram, then paste that provider's key. The key is encrypted on the server and is not returned to the browser.

## x86_64

`ASR_PROVIDER` is set to `transformers`. The first transmission downloads a small Whisper model into the data directory. The same Settings dropdown can switch the default, and each line can override it.

## Cloudflare Tunnel or Tailscale

These are optional and this installer does not change a tunnel that is already running.

Cloudflare Tunnel, both names to the published port (8080 unless you set `PORT`):

```yaml
ingress:
  - hostname: talk.example.com
    service: http://127.0.0.1:8080
  - hostname: admin.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Tailscale: install Tailscale separately, then use the machine's tailnet name as `CLIENT_HOST` and `ADMIN_HOST`, or open `http://<tailscale-ip>:8080/#/` and `http://<tailscale-ip>:8080/#/control`.

## Handsets

The Arduino IDE sketch in `firmware/arduino-nodemcu32s-ptt` uses the same WebSocket messages. Set `SERVER_HOST` to the client hostname. Uncomment `LISTEN_ONLY` for a speaker with no microphone. In the admin room, tick Listen only when you add that device so the wall shows it as a listener even before it connects.
