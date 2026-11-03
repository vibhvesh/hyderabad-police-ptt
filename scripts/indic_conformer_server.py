#!/usr/bin/env python3
"""Optional Telugu sidecar for AI4Bharat IndicConformer.

Not part of the quick demo setup. The Node server calls this only when
INDIC_CONFORMER_URL is set (for example http://127.0.0.1:8099/transcribe).

First-time install is large (PyTorch + AI4Bharat NeMo + the model weights):

  git clone https://github.com/AI4Bharat/NeMo.git
  cd NeMo && git checkout nemo-v2 && bash reinstall.sh

Then run:

  python scripts/indic_conformer_server.py

POST a 16 kHz mono WAV body. Response: {"text": "...", "model": "...", "decoder": "rnnt"}
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8099
MODEL_ID = "ai4bharat/indicconformer_stt_te_hybrid_rnnt_large"
DECODER = "rnnt"

_model = None


def load_model():
    global _model
    if _model is not None:
        return _model
    try:
        import torch
        import nemo.collections.asr as nemo_asr
    except ImportError as exc:
        raise SystemExit(
            "IndicConformer dependencies are not installed. "
            "See the docstring in scripts/indic_conformer_server.py. "
            f"Import error: {exc}"
        ) from exc

    model = nemo_asr.models.ASRModel.from_pretrained(MODEL_ID)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.freeze()
    model = model.to(device)
    model.cur_decoder = DECODER
    _model = model
    return model


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if not body:
            self._json(400, {"error": "empty audio"})
            return
        path = "/tmp/hcp-ptt-indic.wav"
        with open(path, "wb") as handle:
            handle.write(body)
        try:
            model = load_model()
            text = model.transcribe([path], batch_size=1, language_id="te")[0]
            if not isinstance(text, str):
                text = getattr(text, "text", str(text))
        except Exception as exc:  # noqa: BLE001 — surface sidecar failures to the demo
            self._json(500, {"error": str(exc)})
            return
        self._json(200, {"text": text.strip(), "model": MODEL_ID, "decoder": DECODER})

    def log_message(self, fmt, *args):
        print("[indic-conformer]", fmt % args)

    def _json(self, status, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    print(f"IndicConformer sidecar on http://{HOST}:{PORT}/transcribe")
    print("Loading the model on the first transcription request.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
