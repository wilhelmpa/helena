'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardPaste, Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { PageActions } from '@/components/layout/PageToolbar';
import type { PermissionCatalog, Role } from '@/lib/api/endpoints/roles';
import { useIsMac } from '@/context/useHotkeys';
import RolesImportDialog from './RolesImportDialog';
import { useClipboardHasRoles } from '../../hooks/useClipboardHasRoles';
import {
  parseRolesText,
  planRolesImport,
  serializeRoles,
  type PlannedRole,
} from '../../utils/rolesTransfer';
import { copyText, readClipboardText } from '@/utils/clipboard';

// The roles page's actions in the header's toolbar row: create a role, and copy or
// paste the team's roles through the clipboard (with Cmd/Ctrl+C/V shortcuts). Only
// rendered for the team's owner and managers, who manage roles.
export default function TeamRolesToolbar({
  teamId,
  roles,
  catalog,
  onCreate,
}: {
  teamId: number;
  roles: Role[];
  catalog: PermissionCatalog | null;
  onCreate: () => void;
}) {
  const t = useTranslations('teams.roles');
  const mod = useIsMac() ? '⌘' : 'Ctrl';
  const [importing, setImporting] = useState<PlannedRole[] | null>(null);
  const { hasRoles: clipboardHasRoles, recheck } = useClipboardHasRoles();

  const customRoleCount = roles.filter((r) => !r.isDefault).length;

  // Copies the team's non-default roles to the clipboard as JSON.
  const copyRoles = useCallback(async () => {
    if (customRoleCount === 0) {
      toast.info(t('nothingToCopy'));
      return;
    }
    try {
      await copyText(serializeRoles(roles));
      toast.success(t('copiedRoles', { count: customRoleCount }));
      recheck();
    } catch {
      toast.error(t('copyFailed'));
    }
  }, [roles, customRoleCount, t, recheck]);

  // Reads roles from the clipboard, then opens the confirmation dialog.
  const pasteRoles = useCallback(async () => {
    if (!catalog) return;
    let text: string;
    try {
      text = await readClipboardText();
    } catch {
      toast.error(t('readFailed'));
      return;
    }
    try {
      const parsed = parseRolesText(text, catalog);
      setImporting(planRolesImport(parsed, roles));
    } catch (err) {
      // parseRolesText rejects with the key of the reason it refused; anything else
      // reaching here has no key of its own.
      const key = (err instanceof Error ? `transferErrors.${err.message}` : '') as Parameters<
        typeof t.has
      >[0];
      toast.error(t.has(key) ? t(key) : t('parseFailed'));
    }
  }, [catalog, roles, t]);

  // Cmd/Ctrl+C copies, Cmd/Ctrl+V pastes — but only while the team panel is open, not
  // while typing, not while a dialog or the role editor is open, and Cmd+C only when
  // no text is selected (so an intentional text copy still works).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return;
      if (document.querySelector('[data-role-editor], [role="dialog"]')) return;
      if (key === 'c') {
        if ((window.getSelection()?.toString() ?? '') !== '') return;
        e.preventDefault();
        void copyRoles();
      } else {
        e.preventDefault();
        void pasteRoles();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [copyRoles, pasteRoles]);

  return (
    <>
      <PageActions
        actions={[
          {
            id: 'copy',
            label: `${t('copyRoles')} (${mod}C)`,
            icon: Copy,
            disabled: customRoleCount === 0,
            onClick: () => void copyRoles(),
          },
          ...(catalog && clipboardHasRoles
            ? [
                {
                  id: 'paste',
                  label: `${t('pasteRoles')} (${mod}V)`,
                  icon: ClipboardPaste,
                  onClick: () => void pasteRoles(),
                },
              ]
            : []),
        ]}
        primary={{
          id: 'new',
          label: t('newRole'),
          icon: Plus,
          disabled: !catalog,
          onClick: onCreate,
        }}
      />

      {importing && (
        <RolesImportDialog teamId={teamId} planned={importing} onClose={() => setImporting(null)} />
      )}
    </>
  );
}
