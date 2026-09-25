import { Elysia } from 'elysia';
import { requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { errors } from '#shared/responses';
import { TranscriptionResponse, VoiceStatusResponse, speechBody, transcriptionBody } from './model';
import { acquireVoice, requireHuman, synthesize, transcribe, voiceStatus } from './service';

// Voice in the chat (docs/helena-decisions/voice.md): which way dictation and reading aloud go
// now, a recording to text and a sentence to audio on Helena's local AI. For signed-in people;
// an agent's key is refused. The model server's key stays here.

export const voiceRoutes = new Elysia({ name: 'voice', detail: { tags: ['Voice'] } })
  .use(authContext)

  .get(
    '/voice',
    async ({ user }) => {
      await requireHuman(requireUser(user).id);
      return voiceStatus();
    },
    {
      response: { 200: VoiceStatusResponse, ...errors(401, 403) },
      detail: {
        summary: 'Read where dictation and reading aloud run',
        description:
          'For speech to text and text to speech: the Lokale KI mode of the class, whether a ' +
          'local model takes the work right now (and why not), and the limits of one request.',
      },
    },
  )

  .post(
    '/voice/transcriptions',
    async ({ user, body }) => {
      const current = requireUser(user);
      await requireHuman(current.id);
      const release = acquireVoice('transcribe', current.id);
      try {
        return await transcribe({
          audio: new Uint8Array(await body.file.arrayBuffer()),
          language: body.language ?? null,
        });
      } finally {
        release();
      }
    },
    {
      body: transcriptionBody,
      response: { 200: TranscriptionResponse, ...errors(400, 401, 403, 409, 413, 429, 502, 503) },
      detail: {
        summary: 'Turn a recording into text',
        description:
          'Sends the recording to the local transcription model (Lokale KI → Transkription). ' +
          'WAV only (PCM, 8–48 kHz, mono or stereo), 0.3–120 seconds. 409 `voice-local-off` ' +
          "while the class or local AI is off (the browser's own recognition is used then), " +
          '503 `voice-local-unavailable` while local AI cannot take it, 502 ' +
          '`voice-local-failed` when the model failed. Known subtitle hallucinations on silence ' +
          'come back as an empty text.',
      },
    },
  )

  .post(
    '/voice/speech',
    async ({ user, body }) => {
      const current = requireUser(user);
      await requireHuman(current.id);
      const release = acquireVoice('speak', current.id);
      try {
        const speech = await synthesize({ text: body.text });
        return new Response(speech.audio, {
          headers: {
            'content-type': speech.contentType,
            'cache-control': 'private, no-store',
            'x-helena-model': speech.model,
          },
        });
      } finally {
        release();
      }
    },
    {
      body: speechBody,
      // Returns audio bytes, so no typed 200 body.
      response: { ...errors(400, 401, 403, 409, 413, 429, 502, 503) },
      detail: {
        summary: 'Read a sentence aloud',
        description:
          'Audio (WAV) of the text from the local speech model (Lokale KI → Vorlesen), at most ' +
          '1000 characters. Same refusals as the transcription.',
      },
    },
  );
