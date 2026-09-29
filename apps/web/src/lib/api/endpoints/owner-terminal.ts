import { request } from '@/lib/api/core/client';

// The owner terminal (Home -> Terminal, Home -> Security). See
// apps/api/src/modules/owner-terminal for the DTOs this mirrors.

export const OWNER_TERMINAL_KINDS = [
  'shell',
  'claude',
  'codex',
  'local-qwen36',
  'local-qwen38',
  'local-flash',
  'helena-dev-claude',
  'helena-dev-codex',
] as const;
export type OwnerTerminalKind = (typeof OWNER_TERMINAL_KINDS)[number];
export type OwnerTerminalLocalKind = Extract<OwnerTerminalKind, `local-${string}`>;

// The terminals the owner works in (owner, 28.09., O26): Shell, Claude Code, Codex and
// Flash, the local model — each once. The others stay known to the router (sessions of
// an older browser), but are no longer offered.
export const OWNER_TERMINAL_OFFERED = ['shell', 'claude', 'codex', 'local-flash'] as const;
export type OwnerTerminalOfferedKind = (typeof OWNER_TERMINAL_OFFERED)[number];

export interface OwnerTerminalGrant {
  active: boolean;
  method: 'totp' | 'passkey' | null;
  expiresAt: string | null;
  device: string | null;
  ipAddress: string | null;
}

export interface OwnerTerminalAuditEntry {
  id: number;
  event: string;
  kind: string | null;
  sessionName: string | null;
  device: string | null;
  ipAddress: string | null;
  detail: string | null;
  createdAt: string;
}

export interface OwnerTerminalSettings {
  stepUpMethods: ('totp' | 'passkey')[];
  sudoWithoutPassword: boolean;
  // false: LAN sessions open the terminal without a TOTP code (never loopback).
  stepUpRequired: boolean;
  recordOutput: Partial<Record<OwnerTerminalKind, boolean>>;
}

export type OwnerTerminalSettingsPatch = Partial<OwnerTerminalSettings>;

export const stepUpWithTotp = (code: string) =>
  request<{ expiresAt: string }>('/owner-terminal/step-up/totp', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

export const getOwnerTerminalGrant = () => request<OwnerTerminalGrant>('/owner-terminal/grant');

export const revokeOwnerTerminalGrant = () =>
  request<void>('/owner-terminal/grant/revoke', { method: 'POST' });

export const startOwnerTerminalSession = (kind: OwnerTerminalKind, name: string) =>
  request<void>('/owner-terminal/sessions/start', {
    method: 'POST',
    body: JSON.stringify({ kind, name }),
  });

export const endOwnerTerminalSession = (kind: OwnerTerminalKind, name: string) =>
  request<void>('/owner-terminal/sessions/end', {
    method: 'POST',
    body: JSON.stringify({ kind, name }),
  });

export const getOwnerTerminalAudit = () =>
  request<OwnerTerminalAuditEntry[]>('/owner-terminal/audit');

export const getOwnerTerminalSettings = () =>
  request<OwnerTerminalSettings>('/owner-terminal/settings');

export const updateOwnerTerminalSettings = (patch: OwnerTerminalSettingsPatch) =>
  request<OwnerTerminalSettings>('/owner-terminal/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const getOwnerTerminalLocalModels = () =>
  request<{ kind: OwnerTerminalLocalKind; ready: boolean }[]>('/owner-terminal/local-models');
