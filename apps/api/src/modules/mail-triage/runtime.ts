import { randomUUID } from 'node:crypto';
import { readFileSync, readlinkSync } from 'node:fs';
import { databaseRuntimeName, type MailTriageRuntime } from '@repo/db';

let identity: MailTriageRuntime | undefined;

export function triageRuntime(): MailTriageRuntime {
  if (identity) return identity;
  // Root recovery deliberately supports the native Linux deployment only. Refuse
  // before acquiring a claim if a provable runtime identity cannot be obtained.
  if (process.platform !== 'linux')
    throw new Error('Mail triage requires a Linux runtime identity');
  const stat = readFileSync('/proc/self/stat', 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]!;
  const machineId = readFileSync('/etc/machine-id', 'utf8').trim();
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const pidNamespace = readlinkSync('/proc/self/ns/pid');
  if (
    !/^\d+$/.test(startTicks) ||
    !/^[a-f0-9]{32}$/.test(machineId) ||
    !/^[a-f0-9-]{36}$/.test(bootId) ||
    !/^pid:\[\d+\]$/.test(pidNamespace)
  )
    throw new Error('Mail triage runtime identity unavailable');
  identity = {
    version: 1,
    machineId,
    bootId,
    pid: process.pid,
    startTicks,
    pidNamespace,
    uid: process.getuid!(),
    instance: randomUUID(),
    databaseRuntimeName,
  };
  return identity;
}
