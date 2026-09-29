'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Eye, FolderInput, RefreshCw } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useTeam } from '@/services/teams.service';
import { useDecisionClassesQuery } from '@/services/decisions.service';
import {
  useBankAccountsQuery,
  useImportsQuery,
  useReceiptDedupQuery,
  useReceiptProjectionQuery,
  useRebuildReceiptProjection,
  useSetReceiptDedup,
  useSetReceiptProjection,
} from '@/features/receipts/services/receipts.service';
import { AccountsTab } from '@/features/receipts/components/AccountsTab';
import { ImportDialog } from '@/features/receipts/components/ImportDialog';
import { materializeAgentExport, previewAgentExport } from '@/lib/api/endpoints/agents';
import { filesPath } from '@/utils/paths';
import {
  Button,
  ButtonLink,
  Dialog,
  Page,
  SettingsGroup,
  SettingsRow,
  Stack,
  Switch,
  Text,
} from '@/design-system';
import { helenaSettingsPath } from './settingsModalCatalog';

// Projekt › Einstellungen › Wissen & Belege (docs/einstellungen-struktur.md; the page was
// two bare links, owner O60): what the receipts of this project do by themselves, whether
// they also appear as notes in Wissen (for Obsidian and the views), the bank accounts the
// receipts are matched against, and the project's agents as read-only notes. Linking the
// same receipt found twice and the notes are settings of the team (they apply to all its
// projects); taking receipts from invoice mails belongs to the mail classifier.
const MAIL_CLASS = 'helena.mail';

export default function ProjectKnowledgeSettingsPage() {
  const t = useTranslations('settings.knowledge');
  const { project } = useShell();
  const projectKey = project?.project.key ?? '';
  const teamId = project?.project.teamId ?? null;
  const team = useTeam(teamId ?? 0);
  const canManage = team != null && team.role !== 'member';
  const { can, isAdmin } = usePermissions();
  const dedup = useReceiptDedupQuery(teamId);
  const setDedup = useSetReceiptDedup(teamId ?? 0);
  const projection = useReceiptProjectionQuery(teamId);
  const setProjection = useSetReceiptProjection(teamId ?? 0);
  const rebuild = useRebuildReceiptProjection(projectKey);
  const classes = useDecisionClassesQuery(canManage ? teamId : null);
  const mail = classes.data?.classes.find((item) => item.id === MAIL_CLASS);
  const intake = (mail?.setting.config as { receipts?: string } | undefined)?.receipts === 'auto';
  const accounts = useBankAccountsQuery(projectKey, !!projectKey && isAdmin);
  const imports = useImportsQuery(projectKey, !!projectKey && isAdmin);
  const [importFor, setImportFor] = useState<{ accountId: number | null } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = useQuery({
    queryKey: ['agent-export', projectKey],
    queryFn: () => previewAgentExport(projectKey),
    enabled: previewOpen && !!projectKey,
  });
  const materialize = useMutation({
    mutationFn: () => materializeAgentExport(projectKey),
    onSuccess: (result) =>
      toast.success(
        result.changed
          ? t('agentExportWritten', { count: result.notes.length })
          : t('agentExportUnchanged'),
      ),
  });

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
        <SettingsRow
          label={t('projection')}
          description={t('projectionHint')}
          htmlFor="receipt-projection"
        >
          <Switch
            id="receipt-projection"
            checked={projection.data?.enabled ?? false}
            disabled={!canManage || !projection.data || setProjection.isPending}
            onCheckedChange={(value) =>
              void setProjection
                .mutateAsync(value)
                .then(() => toast.success(value ? t('projectionOn') : t('projectionOff')))
                .catch(() => undefined)
            }
          />
        </SettingsRow>
        {projection.data?.enabled && isAdmin && (
          <SettingsRow label={t('projectionRebuild')} description={t('projectionRebuildHint')}>
            <Button
              size="small"
              icon={<RefreshCw size={14} />}
              disabled={rebuild.isPending}
              onClick={() =>
                void rebuild
                  .mutateAsync()
                  .then((result) =>
                    toast.success(
                      t('projectionRebuilt', {
                        projected: result.projected,
                        changed: result.changed,
                      }),
                    ),
                  )
                  .catch(() => undefined)
              }
            >
              {t('projectionRebuildAction')}
            </Button>
          </SettingsRow>
        )}
      </SettingsGroup>

      {isAdmin && (
        <SettingsGroup id="bank-accounts" title={t('bankAccounts')} description={t('bankAccountsHint')}>
            <AccountsTab
              projectKey={projectKey}
              accounts={accounts.data ?? []}
              imports={imports.data ?? []}
              loading={accounts.isPending || imports.isPending}
              onImport={(accountId) => setImportFor({ accountId })}
            />
        </SettingsGroup>
      )}

      {isAdmin && (
        <SettingsGroup title={t('agentExport')}>
          <SettingsRow label={t('agentExportRow')} description={t('agentExportHint')}>
            <Stack gap={2} align="end">
              <Button size="small" icon={<Eye size={14} />} onClick={() => setPreviewOpen(true)}>
                {t('agentExportPreview')}
              </Button>
              <Button
                size="small"
                icon={<FolderInput size={14} />}
                disabled={materialize.isPending}
                onClick={() => materialize.mutate()}
              >
                {t('agentExportWrite')}
              </Button>
            </Stack>
          </SettingsRow>
        </SettingsGroup>
      )}

      {previewOpen && (
        <Dialog title={t('agentExportPreviewTitle')} onClose={() => setPreviewOpen(false)} wide>
          <Stack gap={4} data-agent-export-preview="">
            {preview.isPending ? (
              <Text tone="muted">{t('agentExportLoading')}</Text>
            ) : preview.isError ? (
              <Text tone="danger">{t('agentExportFailed')}</Text>
            ) : (
              <>
                <Text size="xs" tone="muted">
                  {t('agentExportSummary', { count: preview.data!.notes.length })}
                </Text>
                {preview.data!.notes.map((note) => (
                  <Stack key={note.path} gap={1}>
                    <Text size="xs" mono tone="muted">
                      {note.path}
                    </Text>
                    <pre className="ds-code-block">{note.content}</pre>
                  </Stack>
                ))}
                <ButtonLink href={filesPath(projectKey, 'Docs/Agenten')} size="small">
                  {t('agentExportOpenFolder')}
                </ButtonLink>
              </>
            )}
          </Stack>
        </Dialog>
      )}
      {importFor && (
        <ImportDialog
          projectKey={projectKey}
          accounts={accounts.data ?? []}
          initialAccountId={importFor.accountId}
          onClose={() => setImportFor(null)}
        />
      )}
    </Page>
  );
}
