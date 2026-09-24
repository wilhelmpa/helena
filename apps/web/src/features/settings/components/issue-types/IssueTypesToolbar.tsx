'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardPaste, Copy, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { PermissionResource } from '@/lib/api/endpoints/roles';
import type { IssueType } from '@/lib/api/endpoints/issueTypes';
import { SETTINGS_MENU_TRIGGER_CLASS } from '../SettingsToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePermissions } from '@/hooks/usePermissions';
import { useIsMac } from '@/context/useHotkeys';
import { useTransferErrorMessage } from '../../hooks/useTransferErrorMessage';
import IssueTypesImportDialog from './IssueTypesImportDialog';
import {
  parseIssueTypesText,
  planIssueTypesImport,
  serializeIssueTypes,
  type PlannedIssueType,
} from '../../utils/issueTypesTransfer';
import { copyText, readClipboardText } from '@/utils/clipboard';

// The Issue types page's copy/paste menu (like States) in its header row; the page's
// primary action "Add type" opens the inline add form in the list.
export default function IssueTypesToolbar({
  projectKey,
  resource,
  types,
}: {
  projectKey: string;
  resource: PermissionResource;
  types: IssueType[];
}) {
  const t = useTranslations('settings.issueTypes');
  const tTransfer = useTranslations('settings.transfer');
  const transferError = useTransferErrorMessage();
  const { can } = usePermissions();
  const mod = useIsMac() ? '⌘' : 'Ctrl';
  const [importing, setImporting] = useState<PlannedIssueType[] | null>(null);

  const copyTypes = useCallback(async () => {
    if (types.length === 0) {
      toast.info(t('nothingToCopy'));
      return;
    }
    try {
      await copyText(serializeIssueTypes(types));
      toast.success(t('copied', { count: types.length }));
    } catch {
      toast.error(tTransfer('copyFailed'));
    }
  }, [types, t, tTransfer]);

  const pasteTypes = useCallback(async () => {
    let text: string;
    try {
      text = await readClipboardText();
    } catch {
      toast.error(tTransfer('readFailed'));
      return;
    }
    try {
      const parsed = parseIssueTypesText(text);
      setImporting(planIssueTypesImport(parsed, types));
    } catch (err) {
      toast.error(transferError(err, t('parseFailed')));
    }
  }, [types, t, tTransfer, transferError]);

  // Cmd/Ctrl+C copies, Cmd/Ctrl+V pastes — but only on this page, not while typing,
  // and Cmd+C only when no text is selected (so an intentional text copy still works).
  useEffect(() => {
    if (!can(resource, 'create')) return;
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
      if (importing) return;
      if (key === 'c') {
        if ((window.getSelection()?.toString() ?? '') !== '') return;
        e.preventDefault();
        void copyTypes();
      } else {
        e.preventDefault();
        void pasteTypes();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [resource, can, importing, copyTypes, pasteTypes]);

  return (
    <>
      {can(resource, 'create') && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t('menu')} className={SETTINGS_MENU_TRIGGER_CLASS}>
              <MoreHorizontal aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => void copyTypes()} disabled={types.length === 0}>
              <Copy className="size-4" />
              {t('copy')}
              <DropdownMenuShortcut>{mod}C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void pasteTypes()}>
              <ClipboardPaste className="size-4" />
              {t('paste')}
              <DropdownMenuShortcut>{mod}V</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {importing && (
        <IssueTypesImportDialog
          projectKey={projectKey}
          planned={importing}
          onClose={() => setImporting(null)}
        />
      )}
    </>
  );
}
