// Checks voice on a running Helena without a microphone: writes steps for the headless driver
// (~/volition/tools/hl.mjs, signed in as the owner on the LAN) that read GET /voice, send a WAV
// recording to POST /voice/transcriptions (Lokale KI's Whisper) and, when "Vorlesen" is local,
// ask POST /voice/speech for one sentence. The recording travels inside the steps as base64.
//
//   node scripts/voice-live-check.mjs <recording.wav> [project key] > voice-live-steps.json
//   HL_PROFILE=voice node ~/volition/tools/hl.mjs voice-live-steps.json
//
// Make a German recording on a Mac with:
//   say -v Anna -o sample.aiff "Hallo Home, wie spät ist es?"
//   afconvert -f WAVE -d LEI16@16000 -c 1 sample.aiff sample.wav
import { readFileSync } from 'node:fs';

const [file, projectKey = 'VOL'] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/voice-live-check.mjs <recording.wav> [project key]');
  process.exit(2);
}
const base64 = readFileSync(file).toString('base64');

const check = `(async () => {
  const api = window.__ITSAPLAN_ENV__?.apiUrl ?? '';
  const out = {};
  const status = await fetch(api + '/voice', { credentials: 'include' });
  out.status = status.status === 200 ? await status.json() : status.status;
  // Built from base64 in the page: the content security policy allows no fetch of data: URLs.
  const wav = new Blob([Uint8Array.from(atob('${base64}'), (char) => char.charCodeAt(0))], { type: 'audio/wav' });
  const form = new FormData();
  form.append('file', wav, 'recording.wav');
  form.append('language', 'de');
  const started = performance.now();
  const answer = await fetch(api + '/voice/transcriptions', { method: 'POST', credentials: 'include', body: form });
  out.transcription = { http: answer.status, roundTripMs: Math.round(performance.now() - started), body: await answer.json().catch(() => null) };
  const settings = await fetch(api + '/god/voice/settings', { credentials: 'include' });
  out.settings = settings.status === 200 ? await settings.json() : settings.status;
  if (out.status?.speech?.local) {
    // hub/voice-2: the first sound is what counts — a streaming server's first bytes.
    const started = performance.now();
    const spoken = await fetch(api + '/voice/speech', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Guten Morgen, hier spricht Helena. Wie kann ich dir helfen?', language: 'de' }) });
    const reader = spoken.body.getReader();
    let bytes = 0, firstMs = null;
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (firstMs === null) firstMs = Math.round(performance.now() - started); bytes += value.byteLength; }
    const rate = Number(spoken.headers.get('x-helena-sample-rate')) || null;
    out.speech = { http: spoken.status, type: spoken.headers.get('content-type'), rate, bytes, firstAudioMs: firstMs, totalMs: Math.round(performance.now() - started), audioS: rate ? +(bytes / 2 / rate).toFixed(2) : null };
  }
  return JSON.stringify(out);
})()`;

process.stdout.write(
  JSON.stringify([{ goto: `/project/${projectKey}/chat`, settle: 4000 }, { eval: check }], null, 2),
);
