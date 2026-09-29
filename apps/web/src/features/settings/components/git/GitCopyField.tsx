import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { copyText } from '@/utils/clipboard';

import { Stack, Inline } from '@/design-system';

// A labelled read-only value with a copy button: the payload URL and secret the
// user pastes into the repository's webhook form. `masked` hides the value until
// the field is focused.
export default function GitCopyField({
  label,
  value,
  masked = false,
  action,
}: {
  label: string;
  value: string;
  masked?: boolean;
  action?: ReactNode;
}) {
  const t = useTranslations('settings.git');
  const tCommon = useTranslations('common');
  const [revealed, setRevealed] = useState(false);

  async function copy() {
    await copyText(value);
    toast.success(t('copied', { label }));
  }

  return (
    <Stack gap={2}>
      <div className="text-xs font-medium">{label}</div>
      <Inline gap={2} className="flex items-center">
        <Input
          readOnly
          className="font-mono text-xs"
          value={masked && !revealed ? '•'.repeat(24) + value.slice(-4) : value}
          onFocus={() => setRevealed(true)}
        />
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {tCommon('copy')}
        </Button>
        {action}
      </Inline>
    </Stack>
  );
}
