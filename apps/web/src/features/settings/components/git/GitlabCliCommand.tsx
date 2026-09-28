import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { gitlabWebhookCommand } from './gitlabCommand';
import { copyText } from '@/utils/clipboard';

import { Box, Stack, Text } from '@/design-system';

export default function GitlabCliCommand({
  payloadUrl,
  secret,
}: {
  payloadUrl: string;
  secret: string;
}) {
  const t = useTranslations('settings.git');
  const tCommon = useTranslations('common');
  const command = gitlabWebhookCommand(payloadUrl, secret);
  const preview = gitlabWebhookCommand(payloadUrl, '•'.repeat(24) + secret.slice(-4));

  async function copy() {
    await copyText(command);
    toast.success(t('gitlabCommandCopied'));
  }

  return (
    <Stack gap={2}>
      <div className="flex items-center justify-between">
        <Text as="p" size="xs" tone="muted">
          {t.rich('gitlabCliHint', {
            link: (chunks) => (
              <a
                href="https://docs.gitlab.com/cli/"
                target="_blank"
                rel="noreferrer"
                className="text-foreground/70 underline underline-offset-2 hover:text-foreground"
              >
                {chunks}
              </a>
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
