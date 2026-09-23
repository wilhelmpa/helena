import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treaty } from '@elysiajs/eden';
import { app } from '../../app';

// The bearer of the internal orchestration routes. The file is written when this
// module loads, once per test process, because the API caches the token it reads first.
const CONTROL_TOKEN = 'test-control-token-0123456789abcdef0123456789';
const tokenFile = join(mkdtempSync(join(tmpdir(), 'plan-control-')), 'token');
writeFileSync(tokenFile, CONTROL_TOKEN, { mode: 0o600 });
process.env.MASTRA_CONTROL_TOKEN_FILE = tokenFile;

// Treaty client that calls the internal routes the way the Hermes team bridge does.
export function controlApi() {
  return treaty(app, { headers: { authorization: `Bearer ${CONTROL_TOKEN}` } });
}
