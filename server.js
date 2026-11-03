// Tiny static host plus speech-to-text. No npm dependencies.
// Telugu -> IndicConformer URL, English/Hindi -> Google, optional ElevenLabs.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const PORT = Number(process.env.PORT || 43124);
const HOST = process.env.HOST || "127.0.0.1";
const MODEL = "ai4bharat/indicconformer_stt_te_hybrid_rnnt_large";

function loadEnv(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* no .env */ }
}
loadEnv();

const settings = () => ({
  te: process.env.STT_PROVIDER_TE || "indic-conformer",
  en: process.env.STT_PROVIDER_EN || "google",
  hi: process.env.STT_PROVIDER_HI || "google",
  google: process.env.GOOGLE_SPEECH_API_KEY || "",
  eleven: process.env.ELEVENLABS_API_KEY || "",
  elevenModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
  indic: process.env.INDIC_CONFORMER_URL || "",
});

const SAMPLE = {
  te: "డెమో లిపి: తెలుగు స్పీచ్ ఇంజిన్ ఈ సెషన్‌లో కనెక్ట్ కాలేదు. ఇది నమూనా వాక్యం, గుర్తింపు ఫలితం కాదు.",
  en: "Demo transcript: the speech engine is not connected for this language. This sentence is a sample, not a recognition result.",
  hi: "डेमो लिपि: इस भाषा का स्पीच इंजन इस सत्र में जुड़ा नहीं है। यह वाक्य नमूना है, पहचान परिणाम नहीं।",
};
const SHORT = {
  te: "ప్రసారం చాలా చిన్నది — మాటలు గుర్తించలేదు.",
  en: "Transmission too short or silent — no speech detected.",
  hi: "प्रसारण बहुत छोटा या शांत था — बोली नहीं मिली।",
};

function pcm16ToWav(pcm) {
  const data = Buffer.from(pcm);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function fallback(lang, requested, reason) {
  const noSpeech = reason === "too_short" || reason === "silence" || reason === "empty_transcript";
  return { text: noSpeech ? (SHORT[lang] || SHORT.en) : (SAMPLE[lang] || SAMPLE.en), provider: "demo-fallback", requestedProvider: requested, language: lang, fallback: true, reason };
}

function post(url, { headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqFn = u.protocol === "http:" ? httpRequest : httpsRequest;
    const req = reqFn({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method: "POST", headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    req.end(body);
  });
}

async function transcribe(lang, pcm) {
  const cfg = settings();
  const requested = cfg[lang] || "demo-fallback";
  if (pcm.length < 16000 * 2 * 0.35) return fallback(lang, requested, "too_short");
  if (requested === "indic-conformer") {
    if (lang !== "te") return fallback(lang, requested, "indic_conformer_telugu_only");
    if (!cfg.indic) return fallback(lang, requested, "missing_indic_conformer_url");
    const wav = pcm16ToWav(pcm);
    const res = await post(cfg.indic, { headers: { "content-type": "audio/wav", "x-language": "te", "x-decoder": "rnnt", "x-model": MODEL, "content-length": wav.length }, body: wav });
    if (res.status >= 300) throw new Error("IndicConformer HTTP " + res.status);
    const text = String(JSON.parse(res.body).text || "").trim();
    if (!text) return fallback(lang, requested, "empty_transcript");
    return { text, provider: "indic-conformer", requestedProvider: requested, language: "te", fallback: false, reason: null, model: MODEL };
  }
  if (requested === "google") {
    if (!cfg.google) return fallback(lang, requested, "missing_google_key");
    const code = lang === "hi" ? "hi-IN" : lang === "te" ? "te-IN" : "en-IN";
    const alt = lang === "en" ? ["hi-IN"] : ["en-IN"];
    const payload = JSON.stringify({ config: { encoding: "LINEAR16", sampleRateHertz: 16000, languageCode: code, alternativeLanguageCodes: alt, enableAutomaticPunctuation: true }, audio: { content: Buffer.from(pcm).toString("base64") } });
    const res = await post("https://speech.googleapis.com/v1/speech:recognize?key=" + encodeURIComponent(cfg.google), { headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }, body: payload });
    if (res.status >= 300) throw new Error("Google STT HTTP " + res.status);
    const json = JSON.parse(res.body);
    const text = (json.results || []).map((r) => r.alternatives?.[0]?.transcript || "").join(" ").trim();
    if (!text) return fallback(lang, requested, "empty_transcript");
    return { text, provider: "google", requestedProvider: requested, language: lang, fallback: false, reason: null };
  }
  if (requested === "elevenlabs") {
    if (!cfg.eleven) return fallback(lang, requested, "missing_elevenlabs_key");
    const wav = pcm16ToWav(pcm);
    const boundary = "----hcp" + Date.now();
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${cfg.elevenModel}\r\n--${boundary}\r\nContent-Disposition: form-data; name="language_code"\r\n\r\n${lang}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, wav, tail]);
    const res = await post("https://api.elevenlabs.io/v1/speech-to-text", { headers: { "xi-api-key": cfg.eleven, "content-type": "multipart/form-data; boundary=" + boundary, "content-length": body.length }, body });
    if (res.status >= 300) throw new Error("ElevenLabs HTTP " + res.status);
    const text = String(JSON.parse(res.body).text || "").trim();
    if (!text) return fallback(lang, requested, "empty_transcript");
    return { text, provider: "elevenlabs", requestedProvider: requested, language: lang, fallback: false, reason: null, model: cfg.elevenModel };
  }
  return fallback(lang, requested, "provider_is_demo");
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > limit) reject(new Error("too large")); else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const page = () => readFileSync(new URL("./index.html", import.meta.url));

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      const cfg = settings();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, service: "hyderabad-police-ptt-demo", pin: false, indic: Boolean(cfg.indic), google: Boolean(cfg.google), elevenlabs: Boolean(cfg.eleven), model: MODEL }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8") || "{}");
      const lang = body.language === "en" || body.language === "hi" ? body.language : "te";
      const pcm = Buffer.from(String(body.pcm || ""), "base64");
      try {
        const result = await transcribe(lang, pcm);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        const result = fallback(lang, settings()[lang], "provider_error");
        result.detail = String(error.message || error).replace(/key=[^&\s]+/gi, "key=REDACTED").slice(0, 180);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("error");
  }
}).listen(PORT, HOST, () => {
  console.log("Hyderabad Police PTT demo: http://" + (HOST === "0.0.0.0" ? "127.0.0.1" : HOST) + ":" + PORT);
});
