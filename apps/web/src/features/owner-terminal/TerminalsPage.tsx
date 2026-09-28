'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import OwnerTerminalPanel from './OwnerTerminalPanel';
import { Page } from '@/design-system';

// Helena → Terminals (docs/einstellungen-struktur.md, „Endgültig“): the owner terminal
// (Shell, Claude Code, Codex, "Helena weiterentwickeln") as a page of its own, the same
// sessions as the terminal in the tool panel — they live in tmux on the server, so both
// show the same terminals.
export default function TerminalsPage() {
  const t = useTranslations('nav');
  return (
    <Shell globalHome globalTitle={t('sidebarTerminals')} autoOpenGlobalChat={false}>
      <Page variant="bleed" title={t('sidebarTerminals')}>
        <OwnerTerminalPanel />
      </Page>
    </Shell>
  );
}
