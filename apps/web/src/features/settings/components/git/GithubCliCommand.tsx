import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { githubWebhookCommand } from './githubCommand';
import { copyText } from '@/utils/clipboard';

import { Box, Stack, Text } from '@/design-system';

// A copyable `gh` command that registers the repository webhook in one step. The
// payload URL and secret are already inlined; only <owner>/<repo> is left to
// replace. The secret stays masked on screen (like the manual tab's field); only
// the copied text carries the real value.
export default function GithubCliCommand({
  payloadUrl,
  secret,
}: {
  payloadUrl: string;
  secret: string;
}) {
  const t = useTranslations('settings.git');
  const tCommon = useTranslations('common');
  const command = githubWebhookCommand(payloadUrl, secret);
  const preview = githubWebhookCommand(payloadUrl, '•'.repeat(24) + secret.slice(-4));

  async function copy() {
    await copyText(command);
    toast.success(t('commandCopied'));
  }

  return (
    <Stack gap={2}>
      <div className="flex items-center justify-between">
        <Text as="p" size="xs" tone="muted">
          {t.rich('cliHint', {
            placeholder: '<owner>/<repo>',
            link: (chunks) => (
              <a
                href="https://cli.github.com/"
                target="_blank"
                rel="noreferrer"
                className="text-foreground/70 underline underline-offset-2 hover:text-foreground"
              >
                {chunks}
              </a>
            ),
            code: (chunks) => (
              <Box as="code" padX={1} padY={1} className="rounded-sm bg-muted">
                {chunks}
              </Box>
            ),
          })}
        </Text>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {tCommon('copy')}
        </Button>
      </div>
      <Box
        as="pre"
        padX={3}
        padY={2}
        className="overflow-x-auto rounded-md bg-muted font-mono text-xs whitespace-pre"
      >
        {preview}
      </Box>
    </Stack>
  );
}
