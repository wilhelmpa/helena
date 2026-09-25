import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditCheck } from '@/lib/api/endpoints/security';
import { severeFailures } from './securityNeedsYou';

// Only what makes the security state red goes into Start's "Braucht dich".

const check = (id: string, state: AuditCheck['state'], severity: AuditCheck['severity']) =>
  ({ id, group: 'ssh', state, severity, detail: '' }) as AuditCheck;

describe('severe failures of the host audit', () => {
  it('takes failed critical and high checks, nothing else', () => {
    const checks = [
      check('ssh.password', 'fail', 'critical'),
      check('ssh.root', 'fail', 'high'),
      check('ssh.options', 'fail', 'medium'),
      check('net.firewall', 'warn', 'critical'),
      check('web.https', 'pass', 'high'),
    ];
    assert.deepEqual(
      severeFailures(checks).map((c) => c.id),
      ['ssh.password', 'ssh.root'],
    );
  });
});
