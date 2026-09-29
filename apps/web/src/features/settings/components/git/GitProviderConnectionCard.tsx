import { useState } from 'react';
import { ExternalLink, GitBranch, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { GitProviderConnection } from '@/lib/api/endpoints/git';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import SettingsCard from '@/components/common/page/SettingsCard';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  useDisconnectGitProvider,
  useDisconnectGitRepository,
} from '../../services/settings.service';
import GitRepositoryPickerDialog from './GitRepositoryPickerDialog';
import { GIT_PROVIDER_CONFIG } from './providerConfig';

import { Box, Inline, Stack, Text } from '@/design-system';

export default function GitProviderConnectionCard({
  projectKey,
  connection,
  editable,
}: {
  projectKey: string;
  connection: GitProviderConnection;
  editable: boolean;
}) {
  const t = useTranslations('settings.git');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const disconnectProvider = useDisconnectGitProvider(projectKey);
  const disconnectRepository = useDisconnectGitRepository(projectKey, connection.id);
  const providerLabel = GIT_PROVIDER_CONFIG[connection.provider].label;

  async function removeRepository(repositoryId: number) {
    try {
      await disconnectRepository.mutateAsync(repositoryId);
      toast.success(t('nativeRepositoryDisconnected'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('nativeDisconnectFailed'));
    }
  }

  // A failure is toasted by the global mutation handler and keeps the dialog open.
  async function removeProvider() {
    await disconnectProvider.mutateAsync(connection.id);
    toast.success(t('nativeDisconnected', { provider: providerLabel }));
    setConfirmingDisconnect(false);
  }

  return (
    <>
      {confirmingDisconnect && (
        <ConfirmDialog
          title={t('nativeDisconnectProvider')}
          confirmLabel={t('nativeDisconnectProvider')}
          onConfirm={removeProvider}
          onClose={() => setConfirmingDisconnect(false)}
        >
          <p>{t('nativeDisconnectConfirm', { provider: providerLabel })}</p>
        </ConfirmDialog>
      )}
      <SettingsCard>
        <Inline
          gap={4}
          align="start"
          justify="between"
          wrap
          pad={4}
          className="flex flex-wrap items-start justify-between"
        >
          <Stack gap={1} className="min-w-0">
            <Inline gap={2} className="flex items-center">
              <span className="font-medium">{providerLabel}</span>
              <Badge variant="secondary">{t('nativeConnectedStatus')}</Badge>
            </Inline>
            <Text as="p" size="sm" tone="muted">
              {connection.accountLogin} · {connection.baseUrl}
            </Text>
          </Stack>
          {editable && (
            <Inline gap={2} align="stretch" className="flex">
              <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                {t('nativeChooseRepositories')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('nativeDisconnectProvider')}
                disabled={disconnectProvider.isPending}
                onClick={() => setConfirmingDisconnect(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            </Inline>
          )}
        </Inline>
        <div className="divide-y border-t">
          {connection.repositories.length === 0 ? (
            <Box as="p" pad={4}>
              <Text as="span" size="sm" tone="muted">
                {t('nativeNoConnectedRepositories')}
              </Text>
            </Box>
          ) : (
            connection.repositories.map((repository) => (
              <Inline gap={3} padX={4} padY={3} key={repository.id} className="flex items-center">
                <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a
                    href={repository.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {repository.fullName}
                    <ExternalLink className="ms-1 inline size-3" />
                  </a>
                  {repository.lastError && (
                    <Box as="p" marginTop={1} className="truncate">
                      <Text
                        as="span"
                        size="xs"
                        tone="danger"

                        title={repository.lastError}
                      >
                        {repository.lastError}
                      </Text>
                    </Box>
                  )}
                </div>
                <Badge variant={repository.status === 'connected' ? 'secondary' : 'destructive'}>
                  {repository.status === 'connected'
                    ? t('nativeWebhookActive')
                    : t('nativeWebhookError')}
                </Badge>
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('nativeDisconnectRepository')}
                    disabled={disconnectRepository.isPending}
                    onClick={() => void removeRepository(repository.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </Inline>
            ))
          )}
        </div>
      </SettingsCard>
      <GitRepositoryPickerDialog
        projectKey={projectKey}
        connection={connection}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      />
    </>
  );
}
