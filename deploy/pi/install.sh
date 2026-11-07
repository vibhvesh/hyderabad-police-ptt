#!/bin/sh
# Installs the Sanket server on a Raspberry Pi. Run it on the Pi from a checkout.
# It does not contact a mailbox, download a speech model, or open a paid service.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
PREFIX="${PREFIX:-/opt/sanket-ptt}"
ENV_FILE="${ENV_FILE:-/etc/sanket-ptt.env}"
DATA_DIR="${DATA_DIR:-/var/lib/sanket-ptt}"
PROFILE="${PI_PROFILE:-pi5}"

if [ "$(uname -m)" != "aarch64" ] && [ "${ALLOW_NON_ARM:-}" != "1" ]; then
  echo "This installer targets 64-bit Raspberry Pi OS (aarch64). Set ALLOW_NON_ARM=1 to copy the files anyway." >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y espeak-ng
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer, then run this script again." >&2
  exit 1
fi

sudo mkdir -p "$PREFIX" "$DATA_DIR/tls" /etc
sudo rsync -a --delete --exclude node_modules --exclude data --exclude .git "$ROOT/" "$PREFIX/"
sudo chown -R "${SUDO_USER:-$USER}:$(id -gn "${SUDO_USER:-$USER}")" "$PREFIX"
( cd "$PREFIX" && npm ci && VITE_BASE=/ npm run build:root )

if [ ! -f "$ENV_FILE" ]; then
  sudo cp "$PREFIX/.env.example" "$ENV_FILE"
  echo "Wrote $ENV_FILE. Set ADMIN_TOKEN, REVIEWER_TOKEN, and INGEST_TOKEN before starting." >&2
fi

HOST_NAME="$(hostname -s)"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ ! -f "$DATA_DIR/tls/cert.pem" ]; then
  sudo openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
    -keyout "$DATA_DIR/tls/key.pem" -out "$DATA_DIR/tls/cert.pem" \
    -subj "/CN=$HOST_NAME" \
    -addext "subjectAltName=DNS:$HOST_NAME,DNS:localhost,IP:127.0.0.1${LAN_IP:+,IP:$LAN_IP}"
fi

sudo tee /etc/systemd/system/sanket-ptt.service >/dev/null <<EOF
[Unit]
Description=Sanket PTT
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$PREFIX
EnvironmentFile=-$ENV_FILE
Environment=DATA_DIR=$DATA_DIR
Environment=STATIC_DIR=$PREFIX/dist
Environment=PI_PROFILE=$PROFILE
Environment=TLS_CERT=$DATA_DIR/tls/cert.pem
Environment=TLS_KEY=$DATA_DIR/tls/key.pem
Environment=PORT=8443
ExecStart=$(command -v node) --experimental-strip-types $PREFIX/server/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
echo "Unit written. Enable it with: sudo systemctl enable --now sanket-ptt"
echo "Phones must open https:// and trust the generated certificate. http:// on the LAN cannot use the microphone."
echo "Profile $PROFILE does not promise a transcription speed. Pi 3 should stay on ASR_MODEL=tiny."
