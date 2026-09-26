import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

export function deploymentDrainStatus(): (phase: 'running' | 'draining' | 'releasing') => void {
  const path = process.env.HELENA_RUNNER_DRAIN_STATUS;
  if (!path) return () => {};
  if (!isAbsolute(path)) throw new Error('Runner drain status path must be absolute');
  const stat = readFileSync('/proc/self/stat', 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
  if (!startTicks || !/^\d+$/.test(startTicks))
    throw new Error('Runner process identity unavailable');
  const identity = { version: 1, pid: process.pid, startTicks };
  return (phase) => {
    const temporary = `${path}.${process.pid}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ ...identity, phase }) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  };
}
