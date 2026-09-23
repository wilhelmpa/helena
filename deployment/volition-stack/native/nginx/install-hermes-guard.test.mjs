import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const installer = join(directory, 'install-hermes-guard.sh');
const unprotected = `map $http_origin $volition_origin_ok {
    default 0;
    "" 1;
    "http://kingston-server.local" 1;
}

server {
    location /hermes/ {
        auth_request /_plan_auth;
        include /etc/nginx/snippets/volition-tool-proxy-security.conf;
        proxy_pass http://127.0.0.1:9119/;
    }
}
`;

async function fixture({ nginxExit = 0, reloadExit = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hermes-nginx-guard-'));
  const config = join(root, 'volition.conf');
  const log = join(root, 'commands.log');
  const nginx = join(root, 'nginx');
  const systemctl = join(root, 'systemctl');
  await writeFile(config, unprotected);
  await writeFile(
    nginx,
    `#!/bin/sh
printf 'nginx %s\\n' "$*" >> "$TEST_LOG"
exit ${nginxExit}
`,
  );
  await writeFile(
    systemctl,
    `#!/bin/sh
printf 'systemctl %s\\n' "$*" >> "$TEST_LOG"
exit ${reloadExit}
`,
  );
  await Promise.all([chmod(nginx, 0o755), chmod(systemctl, 0o755)]);
  return { config, log, nginx, root, systemctl };
}

function run(target) {
  return spawnSync(installer, [target.config], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NGINX_BIN: target.nginx,
      SYSTEMCTL_BIN: target.systemctl,
      TEST_LOG: target.log,
    },
  });
}

test('adds the exact guard, validates, reloads, and is idempotent', async () => {
  const target = await fixture();
  const first = run(target);
  assert.equal(first.status, 0, first.stderr);
  const config = await readFile(target.config, 'utf8');
  assert.match(config, /if \(\$volition_origin_ok = 0\) \{ return 403; \}/);
  assert.match(config, /Content-Security-Policy "frame-ancestors 'self'" always/);
  assert.match(config, /X-Frame-Options "SAMEORIGIN" always/);
  assert.equal(await readFile(target.log, 'utf8'), 'nginx -t\nsystemctl reload nginx.service\n');

  const second = run(target);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already installed/);
  assert.equal(await readFile(target.log, 'utf8'), 'nginx -t\nsystemctl reload nginx.service\n');
});

test('refuses an unexpected target without changing or reloading it', async () => {
  const target = await fixture();
  await writeFile(target.config, 'server { listen 80; }\n');
  const before = await readFile(target.config, 'utf8');
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(target.config, 'utf8'), before);
  await assert.rejects(readFile(target.log, 'utf8'), { code: 'ENOENT' });
});

test('restores the previous file when nginx validation fails', async () => {
  const target = await fixture({ nginxExit: 1 });
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(target.config, 'utf8'), unprotected);
  assert.equal(await readFile(target.log, 'utf8'), 'nginx -t\n');
  assert.match(result.stderr, /previous configuration was restored/);
});

test('restores and revalidates when reload fails', async () => {
  const target = await fixture({ reloadExit: 1 });
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(target.config, 'utf8'), unprotected);
  assert.equal(
    await readFile(target.log, 'utf8'),
    'nginx -t\nsystemctl reload nginx.service\nnginx -t\nsystemctl reload nginx.service\n',
  );
  assert.match(result.stderr, /previous configuration was restored/);
});
