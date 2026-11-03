#!/bin/bash
# One-command install for Raspberry Pi 5 (Raspberry Pi OS 64-bit).
# Installs the headless edge node only. The web page is the public demo URL.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then exec sudo bash "$0" "$@"; fi
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3 python3-paho-mqtt python3-gpiozero alsa-utils
id hcp-ptt >/dev/null 2>&1 || useradd --system --home-dir /var/lib/hcp-ptt --create-home --shell /usr/sbin/nologin hcp-ptt
getent group audio >/dev/null && usermod -aG audio hcp-ptt || true
getent group gpio >/dev/null && usermod -aG gpio hcp-ptt || true
mkdir -p /opt/hcp-ptt
cp -a "$ROOT/pi/." /opt/hcp-ptt/pi/
if [ ! -f /etc/hcp-ptt.env ]; then
  cat > /etc/hcp-ptt.env <<'EOF'
PTT_GPIO_PIN=17
PTT_ALSA_IN=default
PTT_ALSA_OUT=default
PTT_CALLSIGN=Edge-Pi
PTT_CHANNEL=traffic
PTT_LANGUAGE=te
PTT_HTTP=
EOF
fi
chown root:hcp-ptt /etc/hcp-ptt.env
chmod 640 /etc/hcp-ptt.env
install -m 0644 "$ROOT/pi/hcp-ptt-edge.service" /etc/systemd/system/hcp-ptt-edge.service
chown -R hcp-ptt:hcp-ptt /opt/hcp-ptt
systemctl daemon-reload
systemctl enable --now hcp-ptt-edge.service
echo "Edge node installed. Demo only – not for professional or operational use."
echo "Wire BCM 17 (pin 11) to GND (pin 6). Plug in a USB headset."
