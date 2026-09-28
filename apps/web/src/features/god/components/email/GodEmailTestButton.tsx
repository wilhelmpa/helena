import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { GodEmailForm } from '../../hooks/useGodEmailForm';

import { Inline, Text } from '@/design-system';

export default function GodEmailTestButton({ form }: { form: GodEmailForm }) {
  const t = useTranslations('god.email');

  async function send() {
    try {
      const recipient = await form.test();
      toast.success(t('testSent', { email: recipient }));
    } catch {
      // The global mutation handler shows the API error.
    }
  }

  return (
    <Inline
      gap={3}
      justify="between"
      wrap
      padTop={4}
      className="flex flex-wrap items-center justify-between border-t"
    >
      <Text as="p" size="xs" tone="muted">
        {form.testable ? t('testHint') : t('testConfigureFirst')}
      </Text>
      <Button
        type="button"
        variant="outline"
        onClick={send}
        disabled={!form.testable || form.saving || form.testing}
      >
        {form.testing ? t('testing') : t('test')}
      </Button>
    </Inline>
  );
}
