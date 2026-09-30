import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const ANSWER = 'VOLITION_UPDATE_OK';
const PROMPT = `Reply with exactly ${ANSWER}. Do not use any tools or access files.`;

export async function smoke(runtime, program, model, timeoutMs = 90_000) {
  if (!['codex', 'claude', 'codex-acp', 'claude-agent-acp'].includes(runtime))
    throw new Error('Unbekannte Runtime');
  const cwd = await mkdtemp(join(tmpdir(), 'volition-runtime-smoke-'));
  const acp = runtime.endsWith('-acp');
  const args = acp
    ? []
    : runtime === 'codex'
      ? [
          'exec',
          '--json',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '-m',
          model,
          '-c',
          'model_reasoning_effort="low"',
          PROMPT,
        ]
      : [
          '-p',
          PROMPT,
          '--output-format',
          'json',
          '--model',
          model,
          '--tools',
          '',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
          '--max-turns',
          '1',
        ];
  const child = spawn(program, args, {
    cwd,
    env: process.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let diagnostic = '';
  let answer = '';
  let sequence = 0;
  const pending = new Map();
  let rejectFailure;
  const failure = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  const fail = (error) => {
    rejectFailure(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  const timer = setTimeout(
    () => fail(new Error('Zeitlimit beim Modellaufruf überschritten')),
    timeoutMs,
  );
  const exited = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      fail(error);
      reject(error);
    });
    child.once('close', (code) => {
      if (code !== 0) {
        const error = new Error(
          `Runtime beendet mit Exit ${code}: ${diagnostic.trim().slice(-350)}`,
        );
        fail(error);
        reject(error);
      } else {
        resolve();
        if (acp) fail(new Error('ACP beendet, bevor der Modellaufruf abgeschlossen war'));
      }
    });
  });
  exited.catch(() => {});
  child.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-2000);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (line.length > 1024 * 1024) return fail(new Error('Runtime-Antwort zu groß'));
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!acp) {
      if (runtime === 'claude' && event.type === 'result') {
        if (event.is_error)
          return fail(
            new Error(
              'Claude-Modellaufruf fehlgeschlagen: ' + String(event.result ?? '').slice(0, 300),
            ),
          );
        answer = event.result ?? '';
      }
      if (
        runtime === 'codex' &&
        event.type === 'item.completed' &&
        event.item?.type === 'agent_message'
      )
        answer += event.item.text ?? '';
      if (['error', 'turn.failed'].includes(event.type))
        fail(
          new Error(
            'Codex-Modellaufruf fehlgeschlagen: ' +
              String(event.error?.message ?? event.message ?? '').slice(0, 300),
          ),
        );
      return;
    }
    if (event.id != null && !event.method) {
      const request = pending.get(event.id);
      if (!request) return;
      pending.delete(event.id);
      if (event.error)
        request.reject(
          new Error(
            `ACP ${request.method}: ${event.error.code ?? 'Fehler'} ${event.error.message ?? ''}`,
          ),
        );
      else request.resolve(event.result);
    } else if (event.method === 'session/update') {
      const update = event.params?.update;
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        output += update.content.text;
        if (output.length > 65536) fail(new Error('Modell-Antwort zu groß'));
      }
    } else if (event.id != null && event.method) {
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: event.id,
          error: { code: -32601, message: 'Tools are disabled during update smoke' },
        }) + '\n',
      );
      fail(new Error(`Rauchtest verlangte ein Werkzeug: ${event.method}`));
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject, method });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    await Promise.race([
      failure,
      (async () => {
        if (acp) {
          const initialized = await request('initialize', {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: 'volition-update-smoke', version: '1.0.0' },
          });
          if (initialized.protocolVersion !== 1)
            throw new Error('ACP-Protokollversion nicht kompatibel');
          const session = await request('session/new', { cwd, mcpServers: [] });
          const models = session.models?.availableModels ?? [];
          if (runtime === 'codex-acp') {
            const readOnly = session.modes?.availableModes?.find((mode) => mode.id === 'read-only');
            if (!readOnly) throw new Error('ACP bietet keinen lesenden Rauchtest-Modus an');
            await request('session/set_mode', {
              sessionId: session.sessionId,
              modeId: readOnly.id,
            });
          }
          const selected =
            models.find((entry) => entry.modelId === `${model}[low]`) ??
            models.find((entry) => entry.modelId === model) ??
            models.find((entry) => entry.modelId?.startsWith(model + '['));
          await request('session/set_model', {
            sessionId: session.sessionId,
            modelId: selected?.modelId ?? (runtime === 'codex-acp' ? `${model}[low]` : model),
          });
          const result = await request('session/prompt', {
            sessionId: session.sessionId,
            prompt: [{ type: 'text', text: PROMPT }],
          });
          if (result.stopReason !== 'end_turn')
            throw new Error(`ACP-Modellaufruf abgebrochen: ${result.stopReason}`);
          answer = output;
        } else {
          child.stdin.end();
          await exited;
        }
        if (answer.trim() !== ANSWER)
          throw new Error('Modell lieferte keine gültige Rauchtest-Antwort');
      })(),
    ]);
    return { smoke: 'passed', runtime, model, protocol: acp ? 'acp' : 'cli', answer: ANSWER };
  } finally {
    clearTimeout(timer);
    lines.close();
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The runtime may already have exited and removed its process group.
      }
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await smoke(...process.argv.slice(2))));
  } catch (error) {
    const message = String(error.message).replace(
      /(?:bearer\s+\S+|sk-[\w-]+|(?:token|password|secret|api[_ -]?key)\s*[:=]\s*\S+)/gi,
      '[redacted]',
    );
    console.error(message.slice(0, 500));
    process.exitCode = 1;
  }
}
