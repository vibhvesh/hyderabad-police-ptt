#!/usr/bin/env python3
"""Raspberry Pi 5 push-to-talk edge node for the Hyderabad Police demo.

Joins the same public MQTT relay as the web page. A GPIO button is the PTT key.
USB mic and speaker use arecord/aplay. No PIN. Restarts are handled by systemd;
this process also reconnects the relay itself.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from collections import deque

PREFIX = "hcp-ptt-demo/"
BROKERS = [
    ("broker.emqx.io", 8084, "/mqtt"),
    ("broker.hivemq.com", 8884, "/mqtt"),
    ("test.mosquitto.org", 8081, "/"),
]
FRAME = 1280  # 40 ms at 16 kHz s16le


def log(msg: str) -> None:
    print("[ptt-edge]", msg, flush=True)


class Capture:
    def __init__(self, send, preroll=7, tail=0.25):
        self.send = send
        self.preroll = preroll
        self.tail = tail
        self.ring = deque(maxlen=preroll)
        self.pending = []
        self.phase = "idle"
        self.holding = False
        self.tail_until = 0.0
        self.chunks = []
        self.on_finish = None

    def push(self, frame: bytes, now: float) -> None:
        self.ring.append(frame)
        if self.phase == "wait":
            self.pending.append(frame)
        elif self.phase in ("live", "tail"):
            self._emit(frame)
        if self.phase == "tail" and now >= self.tail_until:
            self.finish()

    def down(self) -> bool:
        if self.phase != "idle":
            return False
        self.holding = True
        self.phase = "wait"
        self.pending = list(self.ring)
        self.chunks = []
        return True

    def grant(self, ok: bool, now: float) -> None:
        if not ok:
            self.phase = "idle"
            self.holding = False
            self.pending = []
            return
        frames = self.pending
        self.pending = []
        self.phase = "live" if self.holding else "tail"
        if self.phase == "tail":
            self.tail_until = now + self.tail
            threading.Timer(self.tail + 0.03, lambda: self.phase == "tail" and self.finish()).start()
        for frame in frames:
            self._emit(frame)

    def up(self, now: float) -> None:
        self.holding = False
        if self.phase == "live":
            self.phase = "tail"
            self.tail_until = now + self.tail
            threading.Timer(self.tail + 0.03, lambda: self.phase == "tail" and self.finish()).start()

    def finish(self) -> None:
        if self.phase == "idle":
            return
        self.phase = "idle"
        audio = b"".join(self.chunks)
        self.chunks = []
        if self.on_finish:
            self.on_finish(audio)

    def _emit(self, frame: bytes) -> None:
        self.chunks.append(frame)
        self.send(frame)


def pcm_message(client_id: str, pcm: bytes) -> bytes:
    ident = client_id.encode()
    return bytes([len(ident)]) + ident + pcm


def run() -> None:
    import paho.mqtt.client as mqtt

    channel = os.environ.get("PTT_CHANNEL", "traffic")
    name = os.environ.get("PTT_CALLSIGN", "Edge-Pi")
    lang = os.environ.get("PTT_LANGUAGE", "te")
    http = os.environ.get("PTT_HTTP", "").rstrip("/")
    pin = int(os.environ.get("PTT_GPIO_PIN", "17"))
    events: queue.Queue = queue.Queue()
    client_id = "pi" + hex(int(time.time() * 1000) % 0xFFFFFF)[2:]

    def on_connect(client, _u, _f, rc, _p=None):
        if rc == 0 or getattr(rc, "is_failure", False) is False:
            client.subscribe(PREFIX + channel + "/#")
            client.publish(PREFIX + channel + "/presence/" + client_id, json.dumps({"id": client_id, "name": name, "ts": int(time.time() * 1000)}), retain=True)
            log("linked " + channel)
            events.put(("up", None))

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=client_id, transport="websockets")
    except Exception:
        client = mqtt.Client(client_id=client_id, transport="websockets")
    client.on_connect = on_connect

    def play(pcm: bytes) -> None:
        try:
            proc = subprocess.Popen(["aplay", "-D", os.environ.get("PTT_ALSA_OUT", "default"), "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "-q", "-"], stdin=subprocess.PIPE)
            proc.stdin.write(pcm)
            proc.stdin.close()
        except OSError as exc:
            log("speaker: " + str(exc))

    def send(frame: bytes) -> None:
        client.publish(PREFIX + channel + "/audio", pcm_message(client_id, frame))

    cap = Capture(send)

    def on_message(_c, _u, msg):
        if not msg.topic.endswith("/audio") or cap.phase != "idle" or not msg.payload:
            return
        n = msg.payload[0]
        if n and msg.payload[1:1 + n].decode("latin1", "replace") != client_id:
            play(msg.payload[1 + n:])

    client.on_message = on_message
    host, port, path = BROKERS[0]
    client.ws_set_options(path=path)
    client.tls_set()

    def connect_forever():
        delay = 0.5
        while True:
            try:
                client.connect(host, port, 20)
                client.loop_start()
                return
            except Exception as exc:
                log("relay down (%s), retry %.1fs" % (exc, delay))
                time.sleep(delay)
                delay = min(8, delay * 2)

    connect_forever()

    def finished(audio: bytes) -> None:
        client.publish(PREFIX + channel + "/floor", json.dumps({"t": "release", "id": client_id}))
        if not http or not audio:
            return
        import urllib.request
        try:
            req = urllib.request.Request(http + "/api/transcribe", data=json.dumps({"language": lang, "pcm": __import__("base64").b64encode(audio).decode()}).encode(), headers={"content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as res:
                body = json.loads(res.read().decode())
            client.publish(PREFIX + channel + "/transcript", json.dumps({"id": client_id, "name": name, "text": body.get("text", ""), "fallback": body.get("fallback", False), "lang": lang}))
        except Exception as exc:
            log("transcript: " + str(exc))

    cap.on_finish = finished

    def mic_loop():
        while True:
            try:
                proc = subprocess.Popen(["arecord", "-D", os.environ.get("PTT_ALSA_IN", "default"), "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "-q"], stdout=subprocess.PIPE)
            except OSError as exc:
                log("mic: " + str(exc))
                time.sleep(2)
                continue
            buf = b""
            while True:
                chunk = proc.stdout.read(FRAME - len(buf))
                if not chunk:
                    break
                buf += chunk
                if len(buf) >= FRAME:
                    events.put(("mic", buf[:FRAME]))
                    buf = buf[FRAME:]
            time.sleep(1)

    threading.Thread(target=mic_loop, daemon=True).start()

    if os.environ.get("PTT_EDGE_STDIN") == "1":
        def stdin_loop():
            for line in sys.stdin:
                word = line.strip().lower()
                if word in ("down", "up"):
                    events.put(("ptt", word))
        threading.Thread(target=stdin_loop, daemon=True).start()
    else:
        from gpiozero import Button
        button = Button(pin, pull_up=True, bounce_time=0.03)
        button.when_pressed = lambda: events.put(("ptt", "down"))
        button.when_released = lambda: events.put(("ptt", "up"))
        log("GPIO %s is PTT" % pin)

    while True:
        kind, payload = events.get()
        now = time.time()
        if kind == "mic":
            cap.push(payload, now)
        elif kind == "ptt" and payload == "down" and cap.down():
            client.publish(PREFIX + channel + "/floor", json.dumps({"t": "claim", "id": client_id, "name": name, "ts": int(now * 1000)}))
            cap.grant(True, now)  # edge keys immediately; other clients still obey the floor message
        elif kind == "ptt" and payload == "up":
            cap.up(now)


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        sent = []
        cap = Capture(lambda frame: sent.append(frame[0]))
        for i in range(5):
            cap.push(bytes([i]), i)
        assert cap.down()
        cap.grant(True, 10)
        assert sent[0] == 0 and cap.phase == "live"
        cap.up(10)
        cap.push(b"\x09", 10)
        assert cap.phase == "tail"
        cap.finish()
        assert cap.phase == "idle"
        print("self-check ok")
    else:
        run()
