import { readFile } from 'node:fs/promises';
import http from 'node:http';
import {
  inboxTriagePayloadSchema,
  inboxTriageResultSchema,
  type InboxTriageResult,
  type WorkEnvelope,
} from '../contracts.ts';

const CAPABILITY = process.env.INBOX_CLASSIFIER_CAPABILITY ?? 'inbox-triage.v1';

function privateClassifierSocket(): string {
  const socketPath = process.env.INBOX_CLASSIFIER_SOCKET ??
    '/run/volition-ipc/mastra-inbox-classifier.sock';
  if (!socketPath.startsWith('/run/volition-ipc/') || !socketPath.endsWith('.sock')) {
    throw new Error('The inbox classifier socket path is invalid');
  }
  return socketPath;
}

async function classifyOverSocket(body: string, token: string): Promise<{ status: number; text: string }> {
  return await new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: privateClassifierSocket(),
      path: '/internal/mastra/inbox/classify',
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 16 * 1024) request.destroy(new Error('Inbox classifier response is too large'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 502,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(110_000, () => request.destroy(new Error('Inbox classifier timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

async function classifierToken(): Promise<string> {
  const path = process.env.INBOX_CLASSIFIER_TOKEN_FILE;
  if (!path?.startsWith('/run/secrets/')) throw new Error('The inbox classifier token file is invalid');
  const token = (await readFile(path, 'utf8')).trim();
  if (Buffer.byteLength(token) < 32 || token.length > 2048) {
    throw new Error('The inbox classifier token is invalid');
  }
  return token;
}

export interface ClassifierAdapter {
  classify(envelope: WorkEnvelope): Promise<InboxTriageResult>;
}

export const privateClassifierAdapter: ClassifierAdapter = {
  async classify(envelope) {
    const payload = inboxTriagePayloadSchema.parse(envelope.payload);
    if (!envelope.context?.capabilityRefs.includes(CAPABILITY)) {
      throw new Error('The project has no grant for the inbox classifier capability');
    }
    const body = JSON.stringify({
      schemaVersion: 1,
      capability: CAPABILITY,
      context: envelope.context,
      eventId: envelope.eventId,
      correlationId: envelope.correlationId,
      payload,
    });
    const response = await classifyOverSocket(body, await classifierToken());
    const text = response.text;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Inbox classifier returned HTTP ${response.status}`);
    }
    if (Buffer.byteLength(text) > 16 * 1024) throw new Error('Inbox classifier response is too large');
    try {
      return inboxTriageResultSchema.parse(JSON.parse(text).result);
    } catch {
      throw new Error('Inbox classifier returned an invalid result');
    }
  },
};
