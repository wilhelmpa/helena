import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, client } from './app';

// The bearer of the internal bootstrap routes the provisioning service calls. The file is
// written when this module loads, once per test process, because the API caches the
// token it reads first.
const PLAN_CONTROL_TOKEN = 'test-plan-control-token-0123456789abcdef012345';
const tokenDirectory = mkdtempSync(join(tmpdir(), 'helena-control-'));
const file = join(tokenDirectory, 'PLAN_CONTROL_TOKEN_FILE');
writeFileSync(file, PLAN_CONTROL_TOKEN, { mode: 0o600 });
process.env.PLAN_CONTROL_TOKEN_FILE = file;

// Treaty client that calls the internal routes the way the provisioning service does.
export function controlApi() {
  return client(app, { headers: { authorization: `Bearer ${PLAN_CONTROL_TOKEN}` } });
}
