import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  WEBHOOK_EVENT_TYPES,
  type Webhook,
  type WebhookEventType,
} from '@/lib/api/endpoints/webhooks';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { isHttpUrl } from '@/utils/url';

import { Stack, Text, Box, Inline } from '@/design-system';

export interface WebhookFormValue {
  url: string;
  events: WebhookEventType[];
  isActive: boolean;
}

// Add/edit dialog for a webhook: the payload URL, the set of subscribed event
// types, and whether it is active. The secret is generated server-side and shown
// on the row, not here.
export function SettingsWebhookDialog({
  projectKey,
  initial,
  saving,
  onSave,
  onClose,
}: {
  projectKey: string;
  initial?: Webhook;
  saving: boolean;
  onSave: (value: WebhookFormValue) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('settings.webhooks');
  const tCommon = useTranslations('common');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [events, setEvents] = useState<Set<WebhookEventType>>(new Set(initial?.events ?? []));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  // Shown once a submit found the URL malformed, and cleared by the next edit.
  const [urlInvalid, setUrlInvalid] = useState(false);

  const valid = url.trim().length > 0 && events.size > 0;

  function toggleEvent(event: WebhookEventType, on: boolean) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (on) next.add(event);
      else next.delete(event);
      return next;
    });
  }

  async function submit() {
    if (!valid) return;
    if (!isHttpUrl(url.trim())) {
      setUrlInvalid(true);
      return;
    }
    // A refused save (the server's URL check) is already shown as a toast by the
    // mutation; the dialog stays open with the entries for a correction.
    await onSave({ url: url.trim(), events: [...events], isActive }).catch(() => undefined);
  }

  const actionLabel = initial ? t('save') : t('create');
  const pendingLabel = initial ? tCommon('saving') : t('creating');

  return (
    <Modal
      title={t(initial ? 'dialogEdit' : 'dialogNew')}
      description={t('dialogHint')}
      scope={projectKey}
      onClose={onClose}
      wide
    >
      <Stack
        as="form"
        gap={4}

        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Stack gap={2}>
          <Label htmlFor="webhook-url">{t('payloadUrl')}</Label>
          <Input
            id="webhook-url"
            autoFocus
            required
            value={url}
            aria-invalid={urlInvalid || undefined}
            aria-describedby={urlInvalid ? 'webhook-url-error' : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlInvalid(false);
            }}
            placeholder="https://example.com/webhook"
          />
          {urlInvalid && (
            <Text as="p" size="xs" tone="danger" id="webhook-url-error">
              {t('invalidUrl')}
            </Text>
          )}
        </Stack>

        <Stack gap={2}>
          <Text as="span" size="sm" className="font-medium">
            {t('events')}
          </Text>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENT_TYPES.map((event) => (
              <Inline as="label" gap={2} key={event} className="flex cursor-pointer items-center">
                <Checkbox
                  checked={events.has(event)}
                  onCheckedChange={(v) => toggleEvent(event, v === true)}
                />
                <Text as="span" size="xs" className="font-mono">
                  {event}
                </Text>
              </Inline>
            ))}
          </div>
        </Stack>

        <Box padTop={4} className="border-t border-border/50">
          <Inline as="label" gap={2} className="flex w-fit cursor-pointer items-center text-sm">
            <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
            <span>{t('active')}</span>
          </Inline>
        </Box>

        <Inline
          gap={2}
          align="stretch"
          justify="end"
          padTop={4}
          className="flex justify-end border-t border-border/50"
        >
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? pendingLabel : actionLabel}
          </Button>
        </Inline>
      </Stack>
    </Modal>
  );
}
