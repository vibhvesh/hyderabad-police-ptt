import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("./index.html", import.meta.url), "utf8").match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const mod = { exports: {} };
new Function("module", "Buffer", src)(mod, Buffer);
const { Radio, TalkCapture, buildWav } = mod.exports;

function bus() {
  const clients = [];
  return {
    connect() {
      const c = { connected: false, _h: {},
        on(ev, fn) { (c._h[ev] ||= []).push(fn); },
        subscribe() {},
        publish(topic, payload) {
          const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
          for (const client of clients) if (client.connected) (client._h.message || []).forEach((fn) => fn(topic, buf));
        },
        end(force) { c.connected = false; if (force) (c._h.close || []).forEach((fn) => fn()); },
      };
      clients.push(c);
      queueMicrotask(() => { c.connected = true; (c._h.connect || []).forEach((fn) => fn()); });
      return c;
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("one talker wins a simultaneous press, and only that talker sends audio", async () => {
  const mqtt = bus();
  const heard = [];
  const a = new Radio(mqtt, { id: "aaaa", ch: "traffic", on() {} });
  const b = new Radio(mqtt, { id: "bbbb", ch: "traffic", on() {} });
  const ear = new Radio(mqtt, { id: "cccc", ch: "traffic", on: (k, v) => { if (k === "audio") heard.push(v.length); } });
  await sleep(20);
  a.join("Alpha"); b.join("Bravo");
  await sleep(20);
  let ag, bg;
  a.claim((ok) => { ag = ok; });
  b.claim((ok) => { bg = ok; });
  await sleep(500);
  assert.equal((ag ? 1 : 0) + (bg ? 1 : 0), 1);
  const winner = ag ? a : b;
  const loser = ag ? b : a;
  assert.equal(a.floor.id, winner.id);
  assert.equal(b.floor.id, winner.id);
  assert.equal(winner.sendAudio(new Int16Array(320)), true);
  assert.equal(loser.sendAudio(new Int16Array(320)), false);
  await sleep(20);
  assert.equal(heard.length, 1);
  ear.leave();
  winner.release();
  await sleep(20);
  assert.equal(a.floor, null);
  assert.equal(b.floor, null);
});

test("pre-roll is sent only after the floor is granted, then a release tail", () => {
  const sent = [];
  const cap = new TalkCapture((frame) => sent.push(frame[0]), { preroll: 3, tailMs: 100 });
  for (let i = 1; i <= 5; i++) cap.push(new Int16Array([i]), i);
  assert.equal(sent.length, 0);
  assert.equal(cap.down(), true);
  cap.push(new Int16Array([6]), 6);
  assert.equal(sent.length, 0);
  cap.grant(true, 7);
  assert.deepEqual(sent, [3, 4, 5, 6]);
  cap.push(new Int16Array([7]), 8);
  assert.equal(sent.at(-1), 7);
  cap.up(8);
  cap.push(new Int16Array([8]), 8);
  assert.equal(cap.phase, "tail");
  cap.push(new Int16Array([9]), 200);
  assert.equal(cap.phase, "idle");
  assert.equal(cap.grant(false, 1), undefined);
});

test("denied floor sends nothing", () => {
  const sent = [];
  const cap = new TalkCapture((frame) => sent.push(frame), { preroll: 2, tailMs: 50 });
  cap.push(new Int16Array([1]), 0);
  cap.down();
  cap.grant(false, 1);
  assert.equal(sent.length, 0);
  assert.equal(cap.phase, "idle");
});

test("wav header is 16-bit mono", () => {
  const wav = new DataView(buildWav([new Int16Array([1, -2, 3])], 16000));
  assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), "RIFF");
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(wav.getUint16(34, true), 16);
});

test("page has no PIN gate", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.equal(/PIN|pin_rejected|1101/.test(html), false);
  assert.match(html, /Demo only – not for professional or operational use\./);
  assert.equal(/[\u0C00-\u0C7F]/.test(html), false);
});
