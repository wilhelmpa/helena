# Decision: voice 2 — a conversation that understands, sounds and answers like one

Status: built on `hub/voice-2`; the GPU voice waits for the owner's OK on its downloads (§6).
Date: 2026-09-26. Owner (2026-09-26 00:05): "Voice-Chat ist nicht gut" — the voice sounds bad,
it understands him badly, and there are too many pauses. Builds on `voice.md` (hub/voice) and
`local-ai-platform.md`; where the two disagree, this one is newer.

## 0. Kurzfassung (für den Owner)

Gemessen, nicht geraten (§1): Zwischen deinem letzten Wort und der ersten Silbe der Antwort
vergingen **rund 11 Sekunden**, und die lokale Spracherkennung hat dich schlecht verstanden:

- **Verstehen:** Die NPU-Spracherkennung (FastFlowLM) ignoriert „Deutsch“ und rät die Sprache
  selbst – daher kamen Sätze auf Englisch oder Portugiesisch zurück („Fácil. É segura.“ um 00:03).
  Sie schneidet längere Sätze nach ~4 s ab (bekannter Fehler), erfindet bei Stille „Thank you.“
  und braucht 2,2 s pro Satz. Auf echten deutschen Sätzen (FLEURS) lag die Fehlerrate bei 21 %;
  Whisper über whisper.cpp mit fest eingestelltem Deutsch schafft 4,6 %.
- **Warten:** 0,8 s Pause + 2,2 s Erkennung + ~6 s bis der Agent (Hermes) sein erstes Wort
  schreibt + 1,8 s, weil das Vorlesen auf das Ende der Antwort wartete.
- **Stimme:** Die Browserstimme (auf dem Mac „Anna“ oder schlimmer) ist die einzige, die Deutsch
  spricht – Lemonades Kokoro kann kein Deutsch.

Was jetzt anders ist:

1. **Spracherkennung auf der GPU mit deutschem Whisper** (whisper.cpp, Whisper large-v3-turbo
   auf Deutsch nachtrainiert). Deutsch ist fest eingestellt, Helena gibt die Namen deiner Agenten
   und Projekte (und deine eigenen Wörter, Einstellung „Wörter, die Helena kennen soll“) als
   Kontext mit, Unsicheres und Erfundenes („Thank you.“, andere Sprache) wird verworfen – dann
   steht im Gespräch „Nicht verstanden – sag es bitte noch einmal“ statt eines falschen Satzes.
2. **Eine natürliche deutsche Stimme auf der GPU** (Qwen3-TTS, Apache-2.0): Sie spricht, während
   der Satz noch entsteht. Die Stimme wird einmal entworfen („warm, freundlich, Anfang 30 …“)
   oder von einer Aufnahme geklont und dann für jeden Satz gleich verwendet.
3. **Schnellantwort:** Ein schnelles lokales Modell hört deinen Satz zuerst. Was das Gespräch
   selbst beantwortet (Gruß, „hörst du mich?“, Uhrzeit, „sag das kürzer“, eine Wissensfrage),
   beantwortet es in einem Bruchteil einer Sekunde; alles, was deine Daten oder eine Aktion
   braucht, gibt es sofort an den Agenten weiter. Es handelt nie selbst, und unter der Antwort
   steht „Schnelle Sprachantwort (…) – nicht der Agent“. Aus, bis du es einschaltest (Lokale KI →
   „Sprachantwort (schnell)“, nach bestandener Auswertung).
4. **Kürzere Pausen:** Der letzte Satz wird vorgelesen, sobald er da ist (nicht erst, wenn die
   Antwort geschlossen ist), die Pause bis zum Abschicken ist einstellbar (Standard 0,6 s statt
   0,8 s), und Agenten antworten auf Gesprochenes kurz und sprechbar – optional mit einem eigenen,
   schnelleren Modell („Modell für Gespräche“).
5. **Messbar:** Die Gesprächszeile zeigt im Tooltip, wo die Zeit der letzten Antwort blieb
   (Pause · Mitschrift · Antwort · Stimme).

Gemessen danach (§2.1, §3.1, §7): Erkennung auf der GPU 0,3–0,8 s statt 2,2 s bei 4,3 % statt
21 % Fehlern auf echten deutschen Sätzen und ohne erfundene Sätze aus Rauschen; die Stimme beginnt
nach ~40 ms und spricht 4× schneller als Echtzeit; **vom letzten Wort bis zum ersten Ton 1,6 s**
mit Schnellantwort und **6,2 s** über den Agenten (vorher ≈ 11 s).

Was du tun musst: die Stimmen probehören (https://claude.ai/artifact/EErbshsqvDpbMXors5M1Fb) und
eine wählen, den Downloads zustimmen (§6, zusammen ≈ 3,1 GB), dann spielt der Orchestrator
`voice.sh install` ein; danach unter Lokale KI → Sprache die Stimme wählen und probehören.

## 1. Measured before (2026-09-26, Kingston)

Test sets (`~/agent-work/voice-2/data`, built by `build_sets.py`):

| Set | What | Clips |
|---|---|---|
| conv-clean | 30 German commands to Helena ("Erstelle bitte eine Aufgabe im Projekt Verve …", names, numbers, English terms) × macOS voices Anna, Sandy, Flo, Reed | 120 |
| conv-noisy | the same with fan-like noise (~12 dB SNR) and a laptop-mic band | 120 |
| fleurs | FLEURS de_de test (Google, CC-BY-4.0): real read speech, ≤ 12 s | 80 |
| probe | no speech: silence, room tone, fan noise, hum, beeps | 12 |

Anna is a natural voice; Sandy/Flo/Reed are Apple's robotic Eloquence voices (a stress test, not
a human). WER after German normalisation (numbers as digits, punctuation off; `evalkit.py`).

**Today's speech recognition** (FastFlowLM Whisper V3 Turbo q4nx on the NPU, through the live
`POST /voice/transcriptions`, `language=de`):

| | WER | Notes |
|---|---|---|
| FLEURS (real German speech) | **21.2 %** | 9/60 cut off after ~16 tokens (FastFlowLM issue #698) |
| conv-clean, Anna | 8.2 % | |
| conv-clean, Sandy | 97.4 % | answered in **English**: `language` is ignored |
| probes (no speech) | 12/12 hallucinated | "Thank you.", "Продолжение следует...", "E aí E aí …" |
| latency | 2.2 s p50 (server 2.2 s) | for 2–5 s clips |

The owner's own turns at 00:02–00:03 read "oder ganz nicht gern.", "is coming to the end. Fácil.
É segura." and "Thank you." — the same three failures.

**Whisper large-v3-turbo on whisper.cpp** (same weights family, `language=de`, greedy, CPU only
for this row): FLEURS **4.6 %**, Anna 6.9 %, but 5.4–5.8 s per clip on 8 CPU threads (too slow
for a conversation; the GPU numbers are in §2).

**The rest of a turn** (the owner's session 00:02–00:03, from `agent_chat_event`):

| Step | Time |
|---|---|
| the ear decides the owner is done (VAD redemption) | 0.8 s |
| transcription (NPU) | 2.2 s |
| agent's first text after the question is stored (Hermes: claim, start, model) | 5.3–7.0 s, p50 6.1 s |
| the answer closed after its text (Hermes saves its session) — the last sentence waited for this | 1.4–2.1 s, p50 1.8 s |
| browser voice starts | ~0.2 s |
| **total, end of speech → first sound** | **≈ 11 s** |

Also found: Lemonade's health check timed out at 00:09 (lemond in D state under memory
pressure), so Helena marked local AI "server-down" and the conversation's ear switched to the
browser's recognition mid-conversation. NPU models live in system RAM; the 31 GB the OS has
is what agents, tests and builds fight over.

## 2. Speech to text

| Option | FLEURS WER | Latency | Where | Licence | Verdict |
|---|---|---|---|---|---|
| FastFlowLM Whisper V3 Turbo q4nx (today) | 21.2 % | 2.2 s | NPU, system RAM | MIT | Rejected: ignores `language`, truncates, hallucinates |
| Whisper large-v3-turbo, whisper.cpp | 4.6 % (CPU run) | GPU: §2.1 | GPU | MIT | Good |
| **primeline whisper-large-v3-turbo-german** (ggml by cstr), whisper.cpp | §2.1 | §2.1 | GPU | Apache-2.0 | **Chosen** if §2.1 confirms |
| Parakeet TDT 0.6B v3 (onnx-asr) | reported 5.0 % | ~0.15 s CPU (reported) | CPU | CC-BY-4.0 | Fallback candidate for a GPU-less install; not measured here (my CPU run was stopped for the orchestrator's deploy) |
| Voxtral Mini 4B Realtime | 6.2 % at 480 ms delay (reported) | streaming | GPU | Apache-2.0 | Later: true streaming, no server we can pin yet |
| Lemonade `whispercpp` recipe | – | – | CPU only on Linux in 2026.39.1 (`cpu_bin`/`npu_bin` only) | – | Rejected: no GPU path in this Lemonade |

### 2.1 Measured on the GPU

Radeon 8060S (gfx1151), whisper.cpp 1.8.4 built on Helena's ROCm 10, Helena's request (§2.2),
2026-09-26 01:45–02:05 (`~/agent-work/voice-2/results/gpu-*`, judged as the API judges):

| Build / flash attention (sanity, 16 clips) | WER | p50 |
|---|---|---|
| with rocWMMA flash attention, `-fa` | **100 %** (garbage: "Pos.com.com.") | 440 ms |
| same build, `-nfa` | 5.2 % | 449 ms |
| **without rocWMMA, `-fa`** (ggml's own kernels) | 5.2 % | **340 ms** |
| without rocWMMA, `-nfa` | 5.2 % | 446 ms |

| Model (full sets, `-nfa`) | FLEURS | Anna | Anna + noise | robotic voices | no-speech clips hallucinated | p50 per turn |
|---|---|---|---|---|---|---|
| Whisper large-v3-turbo f16 + prompt | 4.6 % | 6.0 % | 5.2 % | 81–91 % | 2/12 | 0.75 s |
| **German turbo (primeline) f16 + prompt** | **4.3 %** | 6.9 % | 6.4 % | 78–96 % | 1/12 | 0.76 s |
| German turbo f16, no prompt | 4.5 % | 7.3 % | 6.9 % | 62–85 % | 11/12 ("Vielen Dank.") | 0.75 s |
| German turbo q5_0 + prompt | 4.4 % | 7.3 % | 6.4 % | 77–96 % | 2/12 | 0.80 s |
| German turbo q5_0 + whisper.cpp's Silero VAD (CPU check, 12 + 12 + 12 clips) | 4.3 % | 10.8 % (same clips without VAD: 12.7 %) | – | – | **0/12** | – |
| *today: FastFlowLM on the NPU* | *21.2 %* | *8.2 %* | – | *97 %* | *12/12* | *2.2 s* |

- **Chosen:** the German fine-tune, f16 (the best on real German speech; its authors report larger
  gains on conversational sets), ggml's flash attention (no rocWMMA: `voice.sh`), whisper.cpp's
  own Silero VAD (no decoding of noise), `language=de`, the vocabulary prompt.
- The prompt helps natural speech a little and suppresses the silence hallucinations; on unclear
  speech it can pull Whisper toward English — the judgement drops that as "nicht verstanden"
  rather than sending it (measured: 0 real German sentences dropped).
- The full runs used the `-nfa` build (the bench picked the first of the tied variants); the
  installed `-fa` build without rocWMMA was 25 % faster in the sanity run, so a turn's
  transcription should take **~0.3–0.6 s** instead of 2.2 s.
- whisper.cpp 1.8.4's `no_speech_prob` is always 0 (not implemented), so Helena's segment rule
  (§2.2) does nothing there; the VAD is what stops the hallucinations.
- The robotic Eloquence voices stay bad for every engine; they are a stress test, not a person.

### 2.2 How Helena asks

`modules/voice/service.ts` + `transcript.ts`:

- `language` from the page (de), **temperature 0**, `response_format: verbose_json`, and a
  **`prompt`**: the owner's own words (setting "Wörter, die Helena kennen soll", ≤ 60) then
  Helena's names (Helena, every agent, every project and its key) — Whisper takes it as the text
  before the recording, which is what makes "Verve" come back as "Verve". Lemonade gets what it
  got before (its API documents none of these); a server type says what it takes
  (`ModelServerType.audio.transcriptionContext`, @helena/sdk).
- A segment whisper.cpp itself doubts is speech (`no_speech_prob > 0.6` and `avg_logprob < -1`,
  Whisper's own rule) is dropped.
- The transcript is judged (`judgeTranscript`): subtitle credits, "Thank you.", Cyrillic outros,
  syllable loops → `hallucination`; a German request answered in plainly another language
  (hardly a German function word, clearly more English/Portuguese/Spanish ones) →
  `other-language`. Checked on the live FLM results: all 12 probes and all 22 wrong-language
  answers caught, **0 of 90 real German sentences dropped**. The API answers `text: ''` with
  `dropped`, and the conversation says "Nicht verstanden – sag es bitte noch einmal."

## 3. Text to speech

| Option | German | Licence | Latency on this box | Verdict |
|---|---|---|---|---|
| Browser `speechSynthesis` (today) | device voices; Apple's Eloquence voices are robotic | – | instant | Fallback; now ranked: Premium/Enhanced/Siri/Natural local voices first, novelty voices never (`utils/voicePick.ts`), rate from the settings |
| Lemonade `kokoro-v1` | **no German** | Apache-2.0 | CPU | Rejected |
| Lemonade `MOSS-TTS-Local` (4B, 8.5 GB) | yes (31 languages), quality unverified | Apache-2.0 | ~0.6 s first audio on an RTX 5060 Ti (reported) | Alternative; > 2 GB, larger and slower than Qwen3-TTS |
| **Qwen3-TTS 12 Hz 0.6B Base via qwentts.cpp** (GGUF Q8, 1.3 GB with codec) | official language; best open German WER in CV3-Eval (1.7B: 3.3 %) | Apache-2.0 (weights), MIT (engine) | §3.1 | **Chosen** if §3.1 confirms |
| Chatterbox Multilingual v3 | yes | MIT, but a watermark in every clip | ~3.2 GB, PyTorch only | Rejected: watermark, no streaming, PyTorch service |
| Kyutai Pocket TTS (German) | yes | CC-BY-4.0, **gated** (sign-up) | CPU ~200 ms | Alternative on the CPU; needs the owner's Hugging Face acceptance |
| Piper `de_DE` | thorsten medium/high | engine GPL-3.0 (separate process ok) but **the good voices are fine-tuned from research-only / non-commercial data** | CPU, fast | Rejected for Helena's default (licence), fine for the owner privately |
| Voxtral TTS, OmniVoice, MMS, Fish S2 | – | non-commercial | – | Rejected |

### 3.1 Measured on the GPU

qwentts.cpp (HIP, gfx1151), 10 German answer sentences (names, numbers, English terms), streamed
PCM; "round trip" = the German Whisper transcribing the voice back (a listener's understanding):

| Voice | First audio p50 | Whole sentence p50 | Generation | Round-trip WER |
|---|---|---|---|---|
| **Helena** — designed ("warm, friendly, early thirties"), 0.6B Base, no flash attention | 38 ms | 0.87 s | 3.8× real time | 5.4 % |
| Serena — preset speaker, 0.6B CustomVoice | 28 ms | 1.02 s | 4.3× | 4.3 % |
| Vivian — preset | 29 ms | 0.99 s | 4.3× | 4.3 % |
| Ryan — preset | 28 ms | 1.02 s | 4.2× | 4.3 % |
| *today: the browser's voice (Mac: Anna)* | *instant* | – | – | – |

The first audio arrives in ~30–40 ms (the first request after a start: ~250 ms), so the voice
adds almost nothing to a turn; a sentence is generated ~4× faster than it is spoken. The misreads
are names ("Verve" → "Werther"), which `speakable.ts` and the owner's words cannot fix in the
voice; everything else came back word for word. **How they sound is the owner's call:** the
listening page https://claude.ai/artifact/EErbshsqvDpbMXors5M1Fb has six sentences per voice,
the two designed voices' reference recordings and today's browser voice. Installed by default:
the 0.6B Base with the designed voice `helena`; the CustomVoice talker is in `voice-models.tsv`
(`HELENA_VOICE_TTS_MODEL=qwen3-tts-0.6b-customvoice`) if a preset wins. (The run with flash
attention on did not start: the bench's own port was still taken; the unit uses `--no-fa`,
the measured setting.)

### 3.2 The voice

Qwen3-TTS has no German preset speaker. `voice.sh voice design <name> "<description>"` renders
a German reference sentence with the 1.7B **VoiceDesign** model and encodes it for the 0.6B
Base talker (`qwen-codec`: speaker embedding + reference codes); `voice.sh voice clone` does the
same from a recording (e.g. the owner's own voice, or a CC0 speaker). The server registers every
voice at start (`voice-register-voices`), the owner picks one (Lokale KI → Sprache → Stimme), and
every sentence is generated with the same seed, so an answer keeps one voice.

### 3.3 Streaming and spelling

- `/voice/speech` streams **raw PCM** (24 kHz, `audio/pcm`, `x-helena-sample-rate`) where the
  server generates as it goes; the page plays it chunk by chunk on the audio clock
  (`browser/speakers.ts`, `utils/pcm.ts`) instead of waiting for a whole WAV. Through Web Audio,
  so the browser's echo cancellation knows it and the owner can interrupt by speaking.
- `utils/speakable.ts` spells out what a voice misreads: "z. B." → "zum Beispiel", "ca.", "bzw.",
  "%", "€", "Dr.", task keys ("VOL-42" → "VOL 42"), links (said as their site), emojis dropped —
  for the local voice and the browser's.

## 4. The turn

### 4.1 Early last sentence

A streaming answer's last sentence used to wait for the answer to be closed, which Hermes does
1.4–2.1 s after its text. Now a tail that ends like a finished sentence (`settledTail`,
abbreviation-aware) is read once the text has been quiet for 300 ms.

### 4.2 The pause

The pause that ends a turn is a setting (0.4 / 0.6 / 0.9 / 1.3 s; default 0.6, was a fixed 0.8);
400 ms are kept before the detector was sure (320 cut soft first syllables). A semantic turn
detector (pipecat Smart Turn v3.2, BSD-2, 8 MB ONNX, German 96 %) would let the pause be ~0.3 s
for finished sentences and longer for "ähm …" — not built: it needs Whisper's log-mel features
in the browser and an 8 MB model Helena would have to serve; §9.

### 4.3 Spoken turns reach the agent as spoken

A turn from the conversation is sent with `via: 'voice'` (new column
`agent_chat_message.via`, migration `helena_chat_via`). The runner's prompt starts with a note:
answer in one to three short spoken sentences, no Markdown, lists, links or emojis. The owner
can set a **model for conversations** (Lokale KI → Sprache): spoken turns of threads that follow
the agent's model are answered with it, where the agent's runtime offers it (a faster model with
less reasoning keeps the conversation moving).

### 4.4 Helena's voice reply (class `voice-reply`)

The agent's runtime needs seconds before its first word — Hermes starts per message and reads its
session (p50 6.1 s measured). So a small, fast local model hears a spoken question first
(`modules/voice/reply.ts`):

- It gets the conversation (last 10 turns), the agent's and the person's names, the date and
  time in the person's time zone, and **one tool, `hand_to_agent`**. No other tool, no Helena
  data.
- What the conversation or general knowledge answers it answers itself, streamed into the chat
  like any answer (`appendEvents`), marked `via = 'voice'` and with its model; the chat shows
  "Schnelle Sprachantwort (Qwen3.6…) – nicht der Agent".
- Everything else — the owner's data, anything to do, anything current — it hands over at once:
  the held answer goes back to the runner's queue (`releaseHeldAnswer`) and the agent answers as
  always. So does any failure, a first token later than 2 s, or an API restart (the hold runs
  out after 30 s).
- Text is held back until it is clearly an answer (a sentence, or 60 characters): a model that
  starts writing and then calls the hand-over has said nothing.
- The agent's session is kept: its next turn resumes from its own last answer, with what the voice
  reply said meanwhile framed in front of the question ("Your quick voice reply: …").
- Off by default. A local AI class like the others: **its eval (`reply-eval.ts`, 15 German cases)
  must pass**, and every hand-over case must pass (answering what only the agent knows is the one
  failure that must not happen; one failed hand-over case keeps the class below its threshold).

### 4.5 Where the time goes, visibly

`utils/turnTimings.ts`: pause · transcription · answer · voice, from the owner's last word to the
first sound, in the tooltip of the conversation line's dot and in `data-voice-timings` (the E2E
reads it).

## 5. Settings (Lokale KI → Sprache)

`GET/PATCH /god/voice/settings` (owner/admin), one `app_setting` row `voice.settings`:
pause, words to know (+ Helena's own, shown), voice (from the speech server's list), speaking
rate (browser voice), model for conversations (+ reasoning). `GET /voice` carries what the
browser applies itself (pause, rate).

## 6. Installation (`native/local-ai/voice.sh`)

| Part | What |
|---|---|
| `helena-voice-stt` | whisper.cpp v1.8.4 (commit 9386f239, tarball sha256-pinned) built for gfx1151 on Helena's ROCm 10 tree (llama.cpp's flags **without rocWMMA**, §2.1), `127.0.0.1:13306`, `--request-path /v1 --inference-path /audio/transcriptions -l de -fa -sns -nt --vad` |
| `helena-voice-tts` | qwentts.cpp commit 6a3e9128 + its ggml fork 765bc96f (both archives sha256-pinned, commits checked), `127.0.0.1:13307`, `--lang German --no-fa`; voices registered after every start |
| sandbox | user `helena-voice` (render, video), `ProtectSystem=strict`, `DevicePolicy=closed` + `/dev/kfd` + `char-drm`, `IPAddressAllow=localhost`, `MemoryHigh=3G`/`MemoryMax=6G` (the weights are in VRAM) |
| firewall | `native/hardening`: new loopback ACL `voice` (13306, 13307: root and the API user only), `apply.sh firewall`; the audit checks it (`net.voice_acl`) |
| Helena | server kinds `whisper-cpp` and `qwentts-cpp` (@helena/sdk `ModelServerType.audio`, `voices()`), registered by `apps/api/src/scripts/voice-register.ts` as `helena-stt` / `helena-tts` |

**Downloads needing the owner's OK:**

| Model / source | Size | Licence |
|---|---|---|
| `cstr/whisper-large-v3-turbo-german-ggml` `ggml-model.bin` (f16) | 1.62 GB | Apache-2.0 |
| `ggml-org/whisper-vad` `ggml-silero-v6.2.0.bin` (whisper.cpp's voice detector) | 0.9 MB | MIT |
| `Serveurperso/Qwen3-TTS-GGUF` `qwen-talker-0.6b-base-Q8_0.gguf` | 0.99 GB | Apache-2.0 |
| `Serveurperso/Qwen3-TTS-GGUF` `qwen-tokenizer-12hz-Q8_0.gguf` | 0.29 GB | Apache-2.0 |
| `Serveurperso/Qwen3-TTS-GGUF` `qwen-talker-1.7b-voicedesign-Q4_K_M.gguf` (only to design voices) | 1.18 GB | Apache-2.0 |
| optional, if a preset speaker wins: `qwen-talker-0.6b-customvoice-Q8_0.gguf` | 0.97 GB | Apache-2.0 |
| whisper.cpp v1.8.4, qwentts.cpp + ggml fork sources | ~6 MB | MIT |

## 7. Measured after (E2E, dev stack, fakes with the latencies measured on the GPU)

`scripts/voice-e2e.mjs --steps conversation,timing` in headless Chromium with a fake microphone
(Anna: "Hallo Helena, kannst du mich gut hören?"), the conversation line's `data-voice-timings`:

| Path | Pause | Transcription | First words of the answer | First sound | **Total** |
|---|---|---|---|---|---|
| Helena's voice reply (3 turns, median) | 0.60 s | 0.27 s | 0.45 s | 0.24 s | **1.55 s** |
| the agent (a runner that answers like Hermes: text after 4.7 s, closed 1.5 s later) | 0.60 s | 0.27 s | 5.1 s | 0.20 s | **6.2 s** |
| *before, same agent (§1)* | *0.8 s* | *2.2 s* | *~5–7 s* | *+1.8 s wait + 0.2 s* | *≈ 11 s* |

The voice started 0.2 s after the agent's text arrived — no longer after the answer was closed.

## 8. Tests

- API: `modules/voice/__tests__/unit/voice-2.test.ts` (judgement, settings, PCM passthrough,
  the voice reply's request and stream parsing) and `integration/voice-2.test.ts` (settings,
  whisper.cpp and qwentts.cpp behind fakes, spoken turns and the reply model, the voice reply
  answering, handing over and keeping the agent's session, switched off). The older
  `voice.test.ts` stays green (Lemonade gets what it got).
- Web (node:test via bun): `settledTail`, `turnTimings`, `pcm`, `voicePick`, `speakable`.
- Installer: `native/local-ai/tests/test_voice.py` (pins, builds without rocWMMA, units on
  loopback in a sandbox, catalog, voice design); firewall self-tests with the `voice` ACL.
- E2E: `scripts/voice-e2e.mjs --steps conversation,timing` against the dev stack with
  `scripts/voice-e2e-fakes.ts` (the three servers, with the latencies of §2.1/§3.1) and
  `scripts/voice-e2e-runner.ts` (an agent that answers like Hermes: text after 4.7 s, closed
  1.5 s later).

## 9. Live runbook

`native/local-ai/README.md` → "Voice" (install, firewall ACL, voice design, register, switch the
classes, check).

## 10. Later / not built

- Smart Turn v3.2 in the browser (§4.2).
- Transcribing during the pause: start Whisper after ~250 ms of silence and keep the result if the
  owner stays quiet (re-transcribe the whole turn if not) — saves ~0.3 s per turn.
- Streaming partial transcripts (Voxtral Realtime or Lemonade `/realtime`): the transcription
  would be done when the owner stops.
- The agent's own latency: a persistent Hermes per chat (ACP) instead of a process per message
  would save ~2 s on every agent turn — hub/hermes-in-helena.
- FastFlowLM's Whisper once #698 and the language token are fixed (the NPU is then free for it).
