import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, access } from 'node:fs/promises';

const bundle = process.argv[2];
let requests = 0;
let resumed = false;
let policyCalls = 0;
const server = createServer(async (req, res) => {
  let data = '';
  for await (const chunk of req) data += chunk;
  const body = JSON.parse(data || '{}');
  requests++;
  if (body.model === 'hang') return;
  const messages = body.messages ?? [];
  const hasTool = messages.some((message) => message.role === 'tool');
  if (body.model === 'resume' && hasTool && !resumed) return;
  if (body.model === 'resume' && resumed) {
    assert(hasTool, 'resume must preserve the completed tool result');
    assert(messages.some((message) => JSON.stringify(message).includes('durable.txt')));
  }
  const call = (body.model === 'resume' && !hasTool) || (body.model === 'policy' && !hasTool);
  if (body.model === 'policy' && call) policyCalls++;
  const delta = call
    ? {
        tool_calls: [
          {
            index: 0,
            id: 'write-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: body.model === 'policy' ? 'forbidden.txt' : 'durable.txt',
                content: 'saved once',
              }),
            },
          },
        ],
      }
    : { content: 'Completed.' };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => ({
    id: 'fixture',
    object: 'chat.completion.chunk',
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`);
  res.write(`data: ${JSON.stringify(chunk({}, call ? 'tool_calls' : 'stop'))}\n\n`);
  res.end('data: [DONE]\n\n');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const base = {
  model: 'fixture/answer',
  servers: [
    {
      provider: 'fixture',
      kind: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      local: true,
    },
  ],
  workdir: '/work',
  policy: 'allow',
  memory: { enabled: false },
  tools: { profile: 'coder-lite' },
  sessions: { store: 'file', dir: '/work/sessions' },
  limits: { runBudgetSeconds: 10, firstChunkSeconds: 2 },
};
async function start(config, resume) {
  await writeFile('/work/config.json', JSON.stringify(config));
  const child = spawn(
    '/usr/bin/node',
    [
      bundle,
      'helena-agent',
      '--config',
      '/work/config.json',
      ...(resume ? ['--resume', resume] : []),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const done = once(child, 'close').then(([code, signal]) => ({
    code,
    signal,
    events: stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    stderr,
  }));
  child.stdin.end('Perform the fixture task.');
  return {
    child,
    done,
    events: () =>
      stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean),
  };
}
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    assert(Date.now() < deadline, 'fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
try {
  const first = await start({ ...base, model: 'fixture/resume' });
  await until(() => requests >= 2);
  const session = first.events().find((event) => event.type === 'session').id;
  first.child.kill('SIGKILL');
  assert.equal((await first.done).signal, 'SIGKILL');
  assert.equal(await readFile('/work/durable.txt', 'utf8'), 'saved once');
  resumed = true;
  const continued = await (await start({ ...base, model: 'fixture/resume' }, session)).done;
  assert.equal(continued.code, 0, continued.stderr);
  assert.equal(continued.events.find((event) => event.type === 'session').id, session);
  assert.equal(continued.events.filter((event) => event.type === 'tool-call').length, 0);
  console.log('PASS bundle restart resumes the same durable session');

  const before = requests;
  const canceled = await start({ ...base, model: 'fixture/hang' });
  await until(() => requests > before);
  canceled.child.kill('SIGINT');
  assert.equal((await canceled.done).code, 130);
  console.log('PASS bundle cancellation');

  const timed = await (
    await start({ ...base, model: 'fixture/hang', limits: { runBudgetSeconds: 0.15 } })
  ).done;
  assert.equal(timed.code, 1);
  console.log('PASS bundle deadline');

  const fallback = await (
    await start({
      ...base,
      model: 'offline/halogen',
      fallbackModels: ['fixture/answer'],
      servers: [
        { provider: 'offline', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' },
        ...base.servers,
      ],
    })
  ).done;
  assert.equal(fallback.code, 0, fallback.stderr);
  assert(fallback.events.some((event) => event.type === 'model' && event.id === 'fixture/answer'));
  console.log('PASS unreachable Halogen URL falls back');

  const policy = await (
    await start({
      ...base,
      model: 'fixture/policy',
      policy: 'helena',
      helena: { url: 'http://127.0.0.1:1', apiKeyEnv: 'FIXTURE_KEY' },
    })
  ).done;
  assert.equal(policy.code, 0, policy.stderr);
  assert.equal(policyCalls, 1);
  assert(
    policy.events.some((event) => event.type === 'tool-result' && event.output.includes('BLOCKED')),
  );
  await assert.rejects(access('/work/forbidden.txt'));
  await assert.rejects(access('/srv/volition/source/plan'));
  await assert.rejects(access('/home/wilhelmpa'));
  console.log('PASS policy outage denies writes; live checkout and host home absent');
} finally {
  server.closeAllConnections();
  server.close();
}
