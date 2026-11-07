#!/bin/sh
# Installs the local speech synthesizer. Whisper and translation models download on first use.
set -eu
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y espeak-ng
fi
mkdir -p data/models
echo "espeak-ng: $(command -v espeak-ng)"
echo "Start the server with the local providers:"
echo "ASR_PROVIDER=transformers TRANSLATE_PROVIDER=opus TTS_PROVIDER=espeak MODEL_DIR=$(pwd)/data/models npm run server"
