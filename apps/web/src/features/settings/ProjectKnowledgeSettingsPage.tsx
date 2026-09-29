'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useTeam } from '@/services/teams.service';
import { useDecisionClassesQuery } from '@/services/decisions.service';
import {
  useReceiptDedupQuery,
  useSetReceiptDedup,
} from '@/features/receipts/services/receipts.service';
import { ButtonLink, Page, SettingsGroup, SettingsRow, Switch, Text } from '@/design-system';
import { helenaSettingsPath } from './settingsModalCatalog';

// Projekt › Einstellungen › Wissen & Belege (docs/einstellungen-struktur.md; the page was
// two bare links, owner O60): what the receipts of this project do by themselves. Linking
// the same receipt found twice is a setting of the team (it applies to all its projects);
// taking receipts from invoice mails belongs to the mail classifier and is shown here with
// the way to it. The month's export is an action of the Belege page.
const MAIL_CLASS = 'helena.mail';

export default function ProjectKnowledgeSettingsPage() {
  const t = useTranslations('settings.knowledge');
  const { project } = useShell();
  const teamId = project?.project.teamId ?? null;
  const team = useTeam(teamId ?? 0);
  const canManage = team != null && team.role !== 'member';
  const { can } = usePermissions();
  const dedup = useReceiptDedupQuery(teamId);
  const setDedup = useSetReceiptDedup(teamId ?? 0);
  const classes = useDecisionClassesQuery(canManage ? teamId : null);
  const mail = classes.data?.classes.find((item) => item.id === MAIL_CLASS);
  const intake = (mail?.setting.config as { receipts?: string } | undefined)?.receipts === 'auto';

  if (!project) return null;
  return (
    <Page>
      <SettingsGroup title={t('receiptsTitle')}>
        <SettingsRow
          label={t('autoMerge')}
          description={t('autoMergeHint')}
          htmlFor="receipt-auto-merge"
        >
          <Switch
            id="receipt-auto-merge"
            checked={dedup.data?.autoMerge ?? false}
            disabled={!canManage || !can('documents', 'edit') || !dedup.data || setDedup.isPending}
            onCheckedChange={(value) =>
              void setDedup
                .mutateAsync(value)
                .then(() => toast.success(t('saved')))
                .catch(() => undefined)
            }
          />
        </SettingsRow>
        <SettingsRow label={t('intake')} description={t('intakeHint')}>
          {canManage ? (
            <ButtonLink href={helenaSettingsPath('decisions')} size="small">
              {mail ? (intake ? t('intakeOn') : t('intakeOff')) : t('intakeOpen')}
            </ButtonLink>
          ) : (
            <Text tone="muted">{t('managerOnly')}</Text>
          )}
        </SettingsRow>
      </SettingsGroup>
    </Page>
  );
}
