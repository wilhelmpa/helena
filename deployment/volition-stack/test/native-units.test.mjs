import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

// The systemd units of the native stack. systemd stops and restarts a unit together with
// every unit it Requires=, so one Volition service may require only what it cannot run
// without at all: Postgres and the migration, for Plan's own processes.

const dir = resolve(import.meta.dir, '../native/systemd');
const units = readdirSync(dir)
  .filter((name) => name.startsWith('volition-') && name.endsWith('.service') && !name.includes('@'))
  .map((name) => ({ name, text: readFileSync(resolve(dir, name), 'utf8') }));

function values(text, key) {
  return [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))].flatMap((match) =>
    match[1].trim().split(/\s+/),
  );
}

// Plan's processes and the services that carry its agent work.
const longRunning = [
  'volition-plan-api.service',
  'volition-plan-worker.service',
  'volition-plan-web.service',
  'volition-hermes-runner.service',
  'volition-provisioning.service',
  'volition-project-browser-router.service',
  'volition-terminal.service',
].map((name) => units.find((unit) => unit.name === name));

test('no Volition service requires another one, so a restart of one restarts nothing else', () => {
  for (const { name, text } of units) {
    const required = values(text, 'Requires').filter((unit) => unit.startsWith('volition-'));
    expect({ name, required }).toEqual({
      name,
      required: required.filter((unit) => unit === 'volition-plan-migrate.service'),
    });
    expect({ name, bound: values(text, 'BindsTo') }).toEqual({ name, bound: [] });
  }
});

test('the services around Plan start after what they use and ask for it', () => {
  const unit = (name) => units.find((item) => item.name === name).text;
  for (const name of ['volition-hermes-runner.service', 'volition-provisioning.service']) {
    expect(values(unit(name), 'After')).toContain('volition-plan-api.service');
    expect(values(unit(name), 'Wants')).toContain('volition-plan-api.service');
  }
});

test('every long-running service is restarted however often it fails, with a backoff', () => {
  for (const { name, text } of longRunning) {
    expect({ name, restart: values(text, 'Restart') }).toEqual({ name, restart: ['always'] });
    expect({ name, limit: values(text, 'StartLimitIntervalSec') }).toEqual({ name, limit: ['0'] });
    expect({ name, maxDelay: values(text, 'RestartMaxDelaySec') }).toEqual({
      name,
      maxDelay: ['60'],
    });
  }
});

test('the runner has the time to hand its runs back when it is stopped', () => {
  const runner = units.find((item) => item.name === 'volition-hermes-runner.service').text;
  expect(values(runner, 'KillMode')).toEqual(['mixed']);
  expect(Number(values(runner, 'TimeoutStopSec')[0])).toBeGreaterThanOrEqual(45);
});
