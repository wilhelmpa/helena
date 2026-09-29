import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { GitSettings } from '@/lib/api/endpoints/git';
import { API_URL } from '@/lib/api/core/client';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import { useRegenerateGitSecret } from '../../services/settings.service';
import GitCopyField from './GitCopyField';
import GithubCliCommand from './GithubCliCommand';
import GitlabCliCommand from './GitlabCliCommand';

import { Inline, Text, Stack, Box, Segmented } from '@/design-system';

// One tab per supported host: each takes the same payload URL and secret, but
// names the fields and the pull request trigger differently. Gitea and Forgejo
// share a tab because their webhook form is the same.
const PROVIDERS = [
  { key: 'github', label: 'GitHub', hint: 'hintGithub' },
  { key: 'gitlab', label: 'GitLab', hint: 'hintGitlab' },
  { key: 'gitea', label: 'Gitea / Forgejo', hint: 'hintGitea' },
  { key: 'bitbucket', label: 'Bitbucket', hint: 'hintBitbucket' },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]['key'];

// The tab to open first: the host the newest delivery came from, so a connected
// project shows its own instructions.
function initialTab(provider: string | undefined): ProviderKey {
  const seen = provider?.toLowerCase();
  if (seen === 'forgejo') return 'gitea';
  return PROVIDERS.find((p) => p.key === seen)?.key ?? 'github';
}

// The Connection block: how to register the webhook on a repository, and which
// repositories have delivered so far.
export default function GitConnectionCard({
  projectKey,
  settings,
  editable,
}: {
  projectKey: string;
  settings: GitSettings;
  editable: boolean;
}) {
  const t = useTranslations('settings.git');
  const regenerate = useRegenerateGitSecret(projectKey);
  const [tab, setTab] = useState<ProviderKey>(() => initialTab(settings.repositories[0]?.provider));
  const payloadUrl = `${API_URL}/webhooks/git/${settings.webhookId}`;
  // Null for a member who may read but not edit integrations.
  const secret = settings.secret;

  async function regenerateSecret() {
    await regenerate.mutateAsync();
    toast.success(t('secretRegenerated'));
  }

  const regenerateAction = editable ? (
    <Button
      variant="ghost"
      size="sm"
      disabled={regenerate.isPending}
      onClick={() => void regenerateSecret()}
    >
      {t('regenerate')}
    </Button>
  ) : undefined;

  const hint = (key: (typeof PROVIDERS)[number]['hint']) => (
    <Text as="p" size="xs" tone="muted">
      {t.rich(key, {
        b: (chunks) => <b>{chunks}</b>,
        code: (chunks) => (
          <Box as="code" padX={1} padY={1} className="rounded-sm bg-muted">
            {chunks}
          </Box>
        ),
      })}
    </Text>
  );

  return (
    <SettingsSection title={t('webhookEndpoint')} description={t('webhookEndpointHint')}>
      <SettingsCard className="divide-y divide-border/60">
        {secret == null ? (
          <Box as="p" pad={4}>
            <Text as="span" size="xs" tone="muted">
              {t('connectionRestricted')}
            </Text>
          </Box>
        ) : (
          <>
            {/* One URL and one secret serve every host — they sit above the tabs,
                which carry nothing but each host's instructions. */}
            <Stack gap={4} pad={4}>
              <GitCopyField label={t('payloadUrl')} value={payloadUrl} />
              <GitCopyField
                label={t('webhookSecret')}
                value={secret}
                masked
                action={regenerateAction}
              />
            </Stack>
            <Box as="details" pad={4} className="group">
              <summary className="cursor-pointer list-none text-sm font-medium select-none marker:content-none">
                <Inline
                  as="span"
                  gap={2}
                  className="inline-flex items-center"
                  style={{ display: 'inline-flex' }}
                >
                  <span className="transition-transform group-open:rotate-90">›</span>
                  {t('manualSetup')}
                </Inline>
              </summary>
              <Box marginTop={4}>
                <Stack gap={4}>
                  <Segmented<ProviderKey>
                    label={t('manualSetup')}
                    value={tab}
                    onChange={setTab}
                    options={PROVIDERS.map((p) => ({ value: p.key, label: p.label }))}
                  />
                  {PROVIDERS.filter((p) => p.key === tab).map((p) => (
                    <Stack key={p.key} gap={4}>
                      {hint(p.hint)}
                      {p.key === 'github' && (
                        <GithubCliCommand payloadUrl={payloadUrl} secret={secret} />
                      )}
                      {p.key === 'gitlab' && (
                        <GitlabCliCommand payloadUrl={payloadUrl} secret={secret} />
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            </Box>
          </>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
