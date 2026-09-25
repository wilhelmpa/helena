# Decision: voice in the chat (dictation and conversation mode)

Status: accepted and built on `hub/voice`. Date: 2026-09-25. Owner request (2026-09-25): "Sprache
muss im Chat auch funktionieren und Konversation." Builds on Lokale KI
(`local-ai-platform.md`) and the chat standards (`chat-ui.md` §5, which this replaces for voice).

## 0. Kurzfassung (für den Owner)

- **Diktieren** (Mikrofon im Eingabefeld): Solange Lokale KI → „Transkription (Diktat)" läuft,
  nimmt Helena im Browser auf und Whisper V3 Turbo auf der NPU dieses Rechners schreibt mit. Ist
  sie aus, erkennt der Browser selbst (Chrome/Safari schicken die Aufnahme an Google bzw. Apple).
  Bei „Nur lokal" springt der Browser nie ein.
- **Gespräch** (die Wellen-Taste an der Stelle von „Senden", solange nichts getippt ist):
  freihändig. Du sprichst, eine Sprach-Erkennung im Browser (Silero VAD) merkt, wann du fertig
  bist, der Satz wird mitgeschrieben und gesendet, die Antwort wird **Satz für Satz schon während
  sie entsteht** vorgelesen, dann hört Helena wieder zu. Sprichst du dazwischen, hört sie auf
  vorzulesen. Die Zeile über dem Eingabefeld zeigt: hört zu / hört dich / schreibt mit / antwortet
  gleich / spricht, mit „Unterbrechen" und „Beenden".
- **Vorlesen:** die Stimme des Browsers (die Stimmen des Geräts zuerst), oder – neu – eine lokale
  Stimme über Lokale KI → „Vorlesen (Stimme)". Lemonades kleines Kokoro spricht **kein Deutsch**;
  eine deutsche lokale Stimme (MOSS-TTS-Local, 8,5 GB) braucht dein OK für den Download.
- **Voraussetzung Mikrofon:** Browser geben es nur über HTTPS frei. Bis HTTPS da ist: in Chrome
  `chrome://flags/#unsafely-treat-insecure-origin-as-secure` öffnen, `http://kingston-server.local`
  eintragen, „Enabled", Chrome neu starten (Mac und m5; der Kiosk hat es schon). Safari/iPhone erst
  mit HTTPS. Ohne das erklärt Helena es beim Klick – nie ein stummer Knopf.

## 1. What was built

| Part | Where |
|---|---|
| API: `GET /voice` (which way each path runs), `POST /voice/transcriptions` (WAV → text), `POST /voice/speech` (sentence → WAV) | `apps/api/src/modules/voice/` |
| Lokale KI: `transcription` wired; new class `speech` ("Vorlesen", capability `speech`, not in the master's first set); plain OpenAI-compatible servers list whisper/tts models by name | `modules/local-ai/task-classes.ts`, `server-types.ts` |
| Engine choice (who listens, who speaks) | `apps/web/src/features/voice/utils/voiceEngine.ts` |
| Dictation: MediaRecorder → decode → 16 kHz mono WAV → API; or the browser's recognition | `components/ai-elements/speech-input.tsx`, `features/voice/hooks/useDictation.ts`, `browser/recorder.ts` |
| Conversation: turn-taking state machine, controller, VAD ear, browser-recognition ear, two voices | `features/voice/utils/conversation.ts`, `browser/conversationController.ts`, `browser/vadListener.ts`, `browser/recognitionEar.ts`, `browser/speakers.ts` |
| Reading while streaming: sentences as they complete, code skipped, long sentences cut | `features/voice/utils/speechChunks.ts` |
| UI: the conversation line over the composer, the toggle in the send button's place, every failure explained | `features/voice/components/`, `hooks/useVoiceProblem.ts`, 10 locales (`chatWorkspace.voice`, `localAi.classes.speech`) |
| E2E driver (headless Chrome with a fake microphone) | `scripts/voice-e2e.mjs` |

It is one extension of the local-AI framework, not a path of its own: both directions are task
classes of the `localAiTaskClasses` registry and reach any model server of the `modelServers`
registry that offers a `transcription` or `speech` model (Lemonade today; a plugin's Piper or
Speaches server would plug in the same way).

## 2. Where each path runs

| Lokale KI mode | Dictation and the conversation's ear | Reading aloud |
|---|---|---|
| Master off, or the class **Aus** | the browser's recognition (Chrome, Edge, Safari; Firefox has none → a hint to switch Transkription on) | the browser's voices |
| **Lokal bevorzugt**, local takes it | Helena records, Whisper on this machine | Helena's local voice (Web Audio in the page) |
| **Lokal bevorzugt**, local down | the browser's recognition (the ear switches during a conversation) | the browser's voices (also when the local voice fails mid-answer: it reads on from that sentence) |
| **Nur lokal**, local takes it | local | local |
| **Nur lokal**, local down | nothing: "Deine Stimme verlässt diesen Rechner nicht" | not read aloud (the text is in the chat) |

"Aus" means "as before Lokale KI": the browser's own engines, which Helena never calls. The API
answers `409 voice-local-off` then, `503 voice-local-unavailable` while local cannot take it, `502
voice-local-failed` when the model failed; the browser also learns the state up front from
`GET /voice` (re-read under React Query's `['localAi', …]` key, so switching a class in Lokale KI
refreshes it). Until that answer is known the microphone button stays hidden, so "Nur lokal" never
falls back while it is still on its way. Agents' keys get 403: voice is for people.

The tooltip of the conversation line's dot says where the voice goes ("Whisper auf diesem Rechner"
or "Browser (… an Google bzw. Apple)").

## 3. Speech to text

- **Transport:** Lemonade 2026.39.1 takes WAV only on `/audio/transcriptions` (its docs: "Only `wav`
  audio input is currently supported"; FLM returns no segments). So the browser encodes: the voice
  detector already yields 16 kHz float samples; dictation's MediaRecorder output (Opus/WebM,
  AAC/MP4 on Safari) is decoded with `decodeAudioData` and resampled in an `OfflineAudioContext`.
  16 kHz mono 16-bit PCM = 32 KB/s. The API reads the RIFF header itself (PCM 8/16/24/32-bit,
  8–48 kHz, 1–2 channels) and measures the exact duration.
- **Limits:** 0.3–120 s per request (a dictation or a turn), 12 MB; per person 2 at a time and 200
  per 10 minutes (`429 voice-busy`). A recording with nothing in it (peak below −46 dBFS) is not
  sent at all.
- **Language:** the page's (`de`), so a short turn is not detected as another language.
- **Whisper's hallucinations:** on silence Whisper "hears" subtitle credits ("Untertitel im Auftrag
  des ZDF für funk, 2017", "Untertitel der Amara.org-Community", "Thank you for watching") or sound
  labels ("[Musik]"). A transcript that is only such a line comes back empty
  (`modules/voice/transcript.ts`); anything with real words is kept as is.
- **The key** stays in the API (`readModelServerKey`); the browser only talks to Helena.

Rejected:

- *The browser straight to Lemonade:* the key would be in the browser, and Lemonade listens on
  loopback only.
- *Lemonade's `WS /realtime`* (streaming, server-side VAD, partial transcripts): needs a WebSocket
  proxy through the API and PCM streaming; worth it for live partial text later, not needed for
  turns of a few seconds (the latency per turn is measured in the live check).
- *Hermes' STT as a runner capability* (proposed in `chat-ui.md` §5): Lokale KI already serves
  Whisper with a key and a policy; a detour through a runner adds latency and a second path.
- *Web Speech only:* not in Firefox, audio to Google/Apple, and no "Nur lokal".
- *No eval gate for `transcription`:* the eval context sends chat and embeddings only; a
  transcription eval needs recorded German speech with a free licence (Common Voice DE is CC0) —
  a follow-up. The class can be switched on once wired and a model exists.

## 4. Voice activity detection (when a turn ends)

**Chosen:** [@ricky0123/vad-web](https://github.com/ricky0123/vad) 0.0.31 (ISC, published
2026-09-12) with **Silero VAD v5** (MIT, 2.3 MB ONNX) on **ONNX Runtime Web** 1.30.0 (MIT;
`ort-wasm-simd-threaded.wasm` 14.2 MB + 24 KB glue): the common way to run Silero in a browser.
Silero tells speech from noise (keyboard, fan, music), which an energy gate cannot.

- Loaded only when a conversation starts (dynamic import). Its files are served by Helena itself
  from `/voice/` — `apps/web/scripts/voice-assets.mjs` copies them from `node_modules` before
  `next build`/`next dev` (git-ignored), so the JavaScript Next bundles and the `.wasm` always come
  from the same ONNX Runtime version. No CDN.
- **CSP:** WebAssembly needs `'wasm-unsafe-eval'` in `script-src` (it allows compiling WebAssembly,
  never `eval` of JavaScript). Verified on a production build with the nonce + `'strict-dynamic'`
  policy: the model, the wasm and the AudioWorklet load; ONNX runs single-threaded (no
  cross-origin isolation needed). Should a browser refuse the worklet, vad-web's ScriptProcessor
  takes over.
- **Parameters:** speech above 0.5, silence below 0.35, a turn ends after 0.8 s of silence (a breath
  inside a sentence does not end it), 320 ms kept before the start, at least 250 ms of speech.
  While an answer is read: above 0.8 and at least 500 ms (the echo of the reading is quieter and
  less sure than the owner).

Rejected: an energy gate (no dependency, but noise and the reading's echo start turns and Whisper
then invents words); WebRTC's classic VAD compiled to wasm (older, less accurate, same wasm cost);
the browser recognition's own endpointing (Google, no Firefox); Lemonade's server-side VAD in
`/realtime` (see §3).

## 5. Text to speech

What Lemonade 2026.39.1 serves on `/v1/audio/speech` (read from its installed
`server_models.json` and API docs on Kingston):

| Model | Size | Licence | German | Backend |
|---|---|---|---|---|
| `kokoro-v1` (mikkoph/kokoro-onnx) | 0.35 GB | Apache-2.0 | **no** (en, ja, zh, es, fr, hi, it, pt) | Kokoros (CPU) |
| `MOSS-TTS-Local` (1.5, q8 GGUF) | 8.5 GB | Apache-2.0 | yes (31 languages) | OpenMOSS (GGML) |
| `OpenMOSS-TTS` (1.5, q8 GGUF) | 12.5 GB | Apache-2.0 | yes | OpenMOSS |

Outside Lemonade: Piper `de_DE` voices (thorsten, CC0 data; 60–115 MB; engine MIT in the archived
rhasspy/piper, GPL-3.0 in piper1-gpl) would need a server of their own (e.g. Speaches, MIT) — an
extra service; MOSS-TTS-Nano (100 M parameters, 20 languages incl. German, Apache-2.0, ONNX on the
CPU) is not in Lemonade's catalog yet.

**Chosen:**

- The **browser's voices** stay the default and the fallback: `speechSynthesis` works on plain
  http, needs no download, and Helena now prefers the device's own voices (`localService`) over
  online ones (Chrome's "Google Deutsch" sends the text to Google), and speaks sentence by sentence
  (Chrome stops a single long utterance after ~15 s).
- The **local voice** is built generically: Lokale KI → "Vorlesen (Stimme)" (class `speech`, off
  and not in the master's first set, since the voice must speak the owner's language), any server
  model with the `speech` capability, WAV (the one format every Lemonade speech backend encodes).
  Played through Web Audio in the page, so the browser's echo cancellation knows it and the owner
  can interrupt by voice even on loudspeakers; the next sentences are fetched while one plays.
- **Recommendation (needs the owner's OK: 8.5 GB):** pull `MOSS-TTS-Local` into Lemonade in the
  maintenance window, listen to German, measure its latency per sentence on the GPU, then switch
  "Vorlesen" to it. Kokoro is fine for English only.

## 6. The conversation

- **Turn-taking** is a pure state machine (`utils/conversation.ts`, with tests): listening → hearing →
  transcribing → thinking → speaking → listening. A turn is sent like a typed message: while an
  answer is still coming it waits in the composer's queue. Two breaths of one thought (the second
  begins before the first is written down) become one message.
- **Reading while streaming** (`speechChunks.ts`, with tests): a sentence is handed to the voice once
  the space after it has arrived; list items and lines count too; code blocks are skipped whole and
  wait while open; abbreviations and ordinals ("z. B.", "3. Oktober", "Dr.") do not end a sentence;
  pieces under 12 characters wait for the next; pieces over 280 are cut at a comma. Only answers
  that arrive after the conversation started are read.
- **Barge-in:** when the owner starts speaking while an answer is read, reading pauses; if what was
  said has words, the rest of that answer is dropped and the new turn is sent; if it was noise, the
  reading goes on.
- **Echo guard:** the system voices of `speechSynthesis` bypass the browser's echo cancellation, so
  on loudspeakers the microphone hears the reading. When what was "said" is mostly the words being
  read (`looksLikeEcho`), reading resumes, interrupting by voice is switched off for the rest of
  that conversation ("Unterbrechen" still works), and a hint says so once. Headphones or the local
  voice never trigger it.
- **Stop at any time:** "Beenden" in the line, the pressed toggle, leaving or switching the chat.
  Turning it off releases the microphone at once.
- "Antworten automatisch vorlesen" (the speaker toggle) stays for typed chats and is skipped while a
  conversation reads.

## 7. Secure context and HTTPS

`getUserMedia`, `MediaRecorder` input, `AudioWorklet` and `SpeechRecognition` exist only in a
secure context. On `http://kingston-server.local` every microphone button explains itself (a toast
naming `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, the origin to enter, and a button
copying the flag's address, since a page cannot open `chrome://`). Nothing is origin-specific: on
`https://helena.volition.one` everything works unchanged (`Permissions-Policy: microphone=(self)`
is already set; the browser asks for the microphone once per origin).

## 8. Tests

- API: `modules/voice/__tests__/unit` (WAV reading, hallucination filter, quotas, speech-model
  names) and `__tests__/integration` against a fake Lemonade (the three modes, the key kept
  server-side, limits, refusals, the agent key refused, speech).
- Web (node:test via bun): `features/voice/utils/*.test.ts` (speech chunks, WAV, engine choice,
  turn-taking, echo) and the CSP test.
- E2E (`scripts/voice-e2e.mjs`, headless Chromium with `--use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=<German WAV>`) on the dev stack, both `next dev` and a
  production build with the real CSP, against a fake Lemonade (WAV checks, fixed transcript,
  tone for speech) and a fake runner: the plain-http hint, dictation into the composer, one full
  conversation turn read sentence by sentence, and a barge-in — all passed. Headless Chrome on
  macOS never resolves `getUserMedia`; run it on Linux.

## 9. Later

- Phones on plain http: `<input type="file" accept="audio/*" capture>` records with the OS recorder
  and needs no secure context; the same WAV path could transcribe it locally.
- Live partial transcripts through Lemonade's `/realtime`.
- A transcription eval with CC0 German speech (Common Voice) in the local-AI harness.
- A voice setting for local speech (MOSS takes a free-text voice description).
