'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import { useState } from 'react';
import { Segmented, Stack } from '@/design-system';
import { MCP_CLIENTS, MCP_URL } from '../utils/clients';
import CodeBlock from '@/components/common/CodeBlock';

// The literal the reader swaps for their own key. Passed as a value rather than
// written into the messages: angle brackets in a message are parsed as rich-text tags.
const API_KEY_PLACEHOLDER = '<API_KEY>';

export default function McpConnectionGuide() {
  const t = useTranslations('mcp');
  const clientLabel = (c: (typeof MCP_CLIENTS)[number]) =>
    c.labelKey ? t(`clients.${c.labelKey}`) : c.label;
  const [client, setClient] = useState<string>(MCP_CLIENTS[0].label);

  return (
    <SettingsCard className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        {t.rich('keyHint', {
          apiKey: API_KEY_PLACEHOLDER,
          link: (chunks) => (
            <Link
              href="/account/api-keys"
              className="font-medium text-foreground underline underline-offset-4"
            >
              {chunks}
            </Link>
          ),
          code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
        })}
      </p>

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">{t('endpoint')}</span>
        <CodeBlock code={MCP_URL} />
      </div>

      <Stack gap={3}>
        <Segmented
          label={t('clientTabsAria')}
          value={client}
          onChange={setClient}
          options={MCP_CLIENTS.map((c) => ({ value: c.label, label: clientLabel(c) }))}
        />
        {MCP_CLIENTS.filter((c) => c.label === client).map((c) => (
          <Stack key={c.label} gap={2}>
            {(c.file || c.noteKey) && (
              <p className="text-sm text-muted-foreground">
                {c.file && (
                  <>
                    {t.rich('addToFile', {
                      file: c.file,
                      code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
                    })}
                    {c.noteKey ? '. ' : ''}
                  </>
                )}
                {c.noteKey && t(`notes.${c.noteKey}`, { apiKey: API_KEY_PLACEHOLDER })}
              </p>
            )}
            <CodeBlock code={c.code} />
          </Stack>
        ))}
      </Stack>
    </SettingsCard>
  );
}
