import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { UpdateItem } from '@/lib/api/endpoints/updateCenter';
import { UpdateSummary } from './UpdateCard';

for (const locale of ['ar', 'de', 'en', 'es-ES', 'fr', 'id', 'pt-BR', 'ru', 'uk', 'zh-CN']) {
  it(`translates the unavailable digest runtime in ${locale}`, async () => {
    const { default: updates } = await import(`../../../../messages/${locale}/updates.json`);
    const html = renderToStaticMarkup(
      <NextIntlClientProvider timeZone="UTC" locale={locale} messages={{ updates }}>
        <UpdateSummary
          agentId={null}
          item={{ updateAvailable: true, summaryError: 'digest_runtime_unavailable' } as UpdateItem}
        />
      </NextIntlClientProvider>,
    );
    assert.doesNotMatch(html, /digest_runtime_unavailable|Hermes/);
    assert.ok(html.includes(updates.settings.noAgent));
  });
}
