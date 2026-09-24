import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

const root = resolve(import.meta.dir, '..');
const installer = readFileSync(resolve(root, 'install.sh'), 'utf8');

test('pins and verifies Hermes and Tirith without provider credentials', () => {
  expect(installer).toContain('HERMES_COMMIT="836b5f8253d27fee79b4f833bc43624f06a890b3"');
  expect(installer).toContain('UV_VERSION="0.12.17"');
  expect(installer).toContain('"$UV_BIN" sync --frozen --extra all');
  expect(installer).toContain('TIRITH_VERSION="0.4.2"');
  expect(installer).toContain('AGENT_BROWSER_VERSION="0.26.0"');
  expect(installer).toContain('AGENT_BROWSER_SHA512="a5da927e3c1b152a7eaa7c256f6836ddef705ef78839f322d7dc693c0f716546f3100529e96e180598fa61b8fccf833b5a471b1830d873ea032070edf51dc40d"');
  expect(installer).toContain('npm install --prefix');
  expect(installer).toContain('sha256sum --check --status');
  expect(installer).not.toMatch(/OPENAI_API_KEY=|COPILOT_TOKEN=|ANTHROPIC_API_KEY=/);
});

test('installs the bootstrap timer only after compose validation and starts every bundle', () => {
  for (const compose of [
    'docker-compose.yml',
    'compose.apps.yml',
    'compose.vault.yml',
    'compose.gateway.yml',
  ]) expect(installer).toContain(compose);
  expect(installer).not.toContain('mastra');
  expect(installer).toContain('config --quiet');
  expect(installer).toContain('docker run --rm -v "$PLAN_ROOT:/repo"');
  expect(installer).toContain('docker network create --internal --subnet 172.30.254.0/29 --gateway 172.30.254.1 volition_control');
  expect(installer).toContain('docker volume create itsaplan_web-cache');
  expect(installer).toContain('loginctl enable-linger "$USER"');
  expect(installer).toContain('enable --now volition-hermes-bootstrap.timer');
  expect(installer).toContain('start volition-hermes-bootstrap.service');
});

test('keeps dry-run mutation-free when Hermes or Tirith are absent', () => {
  expect(installer).toContain('stage="$parent/.hermes-agent-install.dry-run"');
  expect(installer).toContain("run curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output '<uv-archive>'");
  expect(installer).toContain("run curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output '<tirith-archive>'");
  expect(installer).toContain("'<plan-api-image>'");
});


test('installs and starts the provisioner', () => {
  expect(installer).toContain('enable --now volition-provisioning.service');
});
