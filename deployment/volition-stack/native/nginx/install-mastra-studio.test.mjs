import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const installer = join(directory, 'install-mastra-studio.sh');
const site = `server {
    listen 80;
    include /etc/nginx/snippets/volition-project-terminal.conf;
}
`;

async function fixture({ nginxExit = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mastra-studio-nginx-'));
  for (const path of ['volition', 'nginx/conf.d', 'nginx/snippets', 'nginx/sites-available']) {
    await mkdir(join(root, path), { recursive: true });
  }
  await writeFile(join(root, 'nginx/sites-available/volition.conf'), site);
  const log = join(root, 'commands.log');
  const nginx = join(root, 'nginx-bin');
  const systemctl = join(root, 'systemctl');
  await writeFile(nginx, `#!/bin/sh\nprintf 'nginx %s\\n' "$*" >> "$TEST_LOG"\nexit ${nginxExit}\n`);
  await writeFile(systemctl, `#!/bin/sh\nprintf 'systemctl %s\\n' "$*" >> "$TEST_LOG"\n`);
  await Promise.all([chmod(nginx, 0o755), chmod(systemctl, 0o755)]);
  return { root, log, nginx, systemctl };
}

function run(target) {
  return spawnSync(installer, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ETC_ROOT: target.root,
      NGINX_BIN: target.nginx,
      SYSTEMCTL_BIN: target.systemctl,
      TEST_LOG: target.log,
    },
  });
}

const read = (target, path) => readFile(join(target.root, path), 'utf8');

test('creates private tokens, the gateway map and the Studio location once', async () => {
  const target = await fixture();
  const first = run(target);
  assert.equal(first.status, 0, first.stderr);
  const gateway = (await read(target, 'volition/mastra-gateway.token')).trim();
  const control = (await read(target, 'volition/mastra-control.token')).trim();
  assert.match(gateway, /^[0-9a-f]{64}$/);
  assert.match(control, /^[0-9a-f]{64}$/);
  assert.notEqual(gateway, control);
  for (const path of ['volition/mastra-gateway.token', 'volition/mastra-control.token', 'nginx/conf.d/volition-mastra-gateway.conf']) {
    assert.equal((await stat(join(target.root, path))).mode & 0o777, 0o600, path);
  }
  assert.equal(
    await read(target, 'nginx/conf.d/volition-mastra-gateway.conf'),
    `map $host $volition_mastra_gateway_token {\n    default "${gateway}";\n}\n`,
  );
  assert.equal(
    await read(target, 'nginx/snippets/volition-mastra-studio.conf'),
    await readFile(join(directory, 'mastra-studio.conf'), 'utf8'),
  );
  const include = '    include /etc/nginx/snippets/volition-mastra-studio.conf;\n';
  assert.equal(
    await read(target, 'nginx/sites-available/volition.conf'),
    site.replace('volition-project-terminal.conf;\n', `volition-project-terminal.conf;\n${include}`),
  );
  assert.equal(await read(target, 'commands.log'), 'nginx -t\nsystemctl reload nginx.service\n');

  const second = run(target);
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await read(target, 'volition/mastra-gateway.token')).trim(), gateway);
  assert.equal((await read(target, 'volition/mastra-control.token')).trim(), control);
  assert.equal((await read(target, 'nginx/sites-available/volition.conf')).split(include).length, 2);
});

test('restores the site when nginx refuses the configuration', async () => {
  const target = await fixture({ nginxExit: 1 });
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.equal(await read(target, 'nginx/sites-available/volition.conf'), site);
  assert.equal(await read(target, 'commands.log'), 'nginx -t\n');
  assert.match(result.stderr, /the site was restored/);
});

test('refuses a site without the expected include', async () => {
  const target = await fixture();
  await writeFile(join(target.root, 'nginx/sites-available/volition.conf'), 'server { listen 80; }\n');
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.equal(await read(target, 'nginx/sites-available/volition.conf'), 'server { listen 80; }\n');
  await assert.rejects(read(target, 'commands.log'), { code: 'ENOENT' });
});
