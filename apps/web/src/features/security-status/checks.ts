import type { AuditCheck, AuditState } from '@/lib/api/endpoints/security';

// The checks of deployment/volition-stack/native/hardening/audit.sh, by the key their
// title has in messages/<locale>/serverSecurity.json ("ssh.password" → "ssh_password").
// A check this build does not know yet shows its id.
export const CHECK_KEYS = [
  'net_firewall',
  'net_self_guard',
  'net_loopback_acl',
  'net_voice_acl',
  'net_listeners',
  'net_local_owner',
  'net_redis',
  'net_syncthing_nat',
  'ssh_password',
  'ssh_root',
  'ssh_allow_users',
  'ssh_options',
  'web_https',
  'web_tunnel_entry',
  'web_production',
  'web_leftovers',
  'tunnel_service',
  'tunnel_edge',
  'tunnel_acl',
  'tls_certificate',
  'tls_renewal',
  'auth_second_factor',
  'auth_step_up',
  'auth_registration',
  'auth_sessions',
  'auth_sudo',
  'sys_time',
  'sys_sysctl',
  'sys_updates',
  'sys_reboot',
  'sys_journald',
  'sys_services',
  'sys_shells',
  'sys_secure_boot',
  'sys_encryption',
  'files_backups',
  'files_secrets',
  'files_agent_code',
  'svc_exposure',
  'svc_tools_loopback',
  'svc_notes',
] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

export const GROUP_KEYS = [
  'network',
  'ssh',
  'web',
  'tunnel',
  'tls',
  'auth',
  'system',
  'files',
  'services',
] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export function checkKey(id: string): CheckKey | null {
  const key = id.replace(/\./g, '_');
  return (CHECK_KEYS as readonly string[]).includes(key) ? (key as CheckKey) : null;
}

export function groupKey(group: string): GroupKey | null {
  return (GROUP_KEYS as readonly string[]).includes(group) ? (group as GroupKey) : null;
}

const STATE_ORDER: Record<AuditState, number> = { fail: 0, warn: 1, skip: 2, pass: 3 };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

// Findings first (failed before warnings), the most severe on top; then the rest.
export function sortChecks(checks: AuditCheck[]): AuditCheck[] {
  return [...checks].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.id.localeCompare(b.id),
  );
}
