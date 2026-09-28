'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateInstanceScimToken } from '../../services/god.service';
import { copyText } from '@/utils/clipboard';

import { Stack, Text, Inline } from '@/design-system';

// The generated token is kept in this dialog only, never lifted into page state: it
// is shown once, right after it is generated, and cannot be retrieved later.
// Generating one replaces the previous token, which stops working immediately.
export default function GodScimTokenDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('god.scim.tokenDialog');
  const tCommon = useTranslations('common');
  const create = useCreateInstanceScimToken();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!token) return;
    try {
      await copyText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (no permission / insecure origin); ignore.
    }
  }

  if (token !== null) {
    return (
      <Modal title={t('createdTitle')} onClose={onClose}>
        <Stack gap={4}>
          <Text as="p" size="sm" tone="muted">
            {t('createdDescription')}
          </Text>
          <Inline gap={2} className="flex items-center">
            <Input
              readOnly
              value={token}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              title={t('copy')}
              onClick={() => void copy()}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </Inline>
          <div className="flex justify-end">
            <Button onClick={onClose}>{tCommon('done')}</Button>
          </div>
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal title={t('title')} onClose={onClose}>
      <Stack gap={4}>
        <Text as="p" size="sm" tone="muted">
          {t('description')}
        </Text>
        <Inline gap={2} align="stretch" justify="end" className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            disabled={create.isPending}
            onClick={() => create.mutate(undefined, { onSuccess: (data) => setToken(data.token) })}
          >
            {create.isPending ? t('submitPending') : t('submit')}
          </Button>
        </Inline>
      </Stack>
    </Modal>
  );
}
