'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/services/queryKeys';
import {
  getOwnerTerminalLocalModels,
  endOwnerTerminalSession,
  getOwnerTerminalAudit,
  getOwnerTerminalGrant,
  getOwnerTerminalSettings,
  revokeOwnerTerminalGrant,
  startOwnerTerminalSession,
  stepUpWithTotp,
  updateOwnerTerminalSettings,
  type OwnerTerminalKind,
  type OwnerTerminalSettingsPatch,
} from '@/lib/api/endpoints/owner-terminal';

// Every 30s: cheap enough for a single-owner instance, and short enough that the
// grant banner's countdown and an out-of-band revoke (another tab, or Home ->
// Security) both show up quickly without a websocket for something this low
// stakes.
const GRANT_POLL_MS = 30_000;

export function useOwnerTerminalGrantQuery() {
  return useQuery({
    queryKey: qk.ownerTerminalGrant,
    queryFn: () => getOwnerTerminalGrant(),
    refetchInterval: GRANT_POLL_MS,
  });
}

export function useStepUpWithTotp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => stepUpWithTotp(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.ownerTerminalGrant }),
  });
}

export function useRevokeOwnerTerminalGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeOwnerTerminalGrant(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.ownerTerminalGrant }),
  });
}

// Best-effort audit trail of a tab opening/closing -- a failure here must never
// block or unmount the terminal itself (see OwnerTerminalPanel), so callers use
// these directly rather than through a mutation that would toast the failure.
export const startOwnerTerminalAuditSession = (kind: OwnerTerminalKind, name: string) =>
  startOwnerTerminalSession(kind, name).catch(() => {});
export const endOwnerTerminalAuditSession = (kind: OwnerTerminalKind, name: string) =>
  endOwnerTerminalSession(kind, name).catch(() => {});

// Ends the session behind a tab for good: its tmux session and the program in it
// (the router's close path, native/owner-terminal/owner-terminal-router.mjs). Best
// effort like the audit calls above: the tab closes either way.
export const closeOwnerTerminalSession = (kind: OwnerTerminalKind, name: string) =>
  fetch(`/focus/owner-terminal/${kind}/${name}/__helena/close`, {
    method: 'POST',
    credentials: 'same-origin',
  }).then(
    () => undefined,
    () => undefined,
  );

export function useOwnerTerminalAuditQuery() {
  return useQuery({ queryKey: qk.ownerTerminalAudit, queryFn: () => getOwnerTerminalAudit() });
}

export function useOwnerTerminalSettingsQuery() {
  return useQuery({
    queryKey: qk.ownerTerminalSettings,
    queryFn: () => getOwnerTerminalSettings(),
  });
}

export function useUpdateOwnerTerminalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: OwnerTerminalSettingsPatch) => updateOwnerTerminalSettings(patch),
    onSuccess: (settings) => queryClient.setQueryData(qk.ownerTerminalSettings, settings),
  });
}

export function useOwnerTerminalLocalModels() {
  return useQuery({
    queryKey: qk.ownerTerminalLocalModels,
    queryFn: getOwnerTerminalLocalModels,
    refetchInterval: GRANT_POLL_MS,
  });
}
