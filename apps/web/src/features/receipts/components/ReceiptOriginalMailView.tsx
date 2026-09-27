'use client';

import { useTranslations } from 'next-intl';
import type { ReceiptOriginalMail } from '@/lib/api/endpoints/receipts';

export default function ReceiptOriginalMailView({ mail }: { mail: ReceiptOriginalMail }) {
  const t = useTranslations('receipts.detail');
  return (
    <section dir="auto" className="min-w-0 space-y-3">
      <h3 className="font-medium">{mail.subject}</h3>
      <p className="text-sm text-muted-foreground">
        {`${mail.fromName} <${mail.fromAddress}> · ${mail.sentAt.slice(0, 10)}`}
      </p>
      <pre className="font-sans text-sm break-words whitespace-pre-wrap">{mail.text}</pre>
      {mail.htmlText && mail.htmlText.trim() !== mail.text.trim() && (
        <details>
          <summary>{t('sourceHtmlText')}</summary>
          <pre className="font-sans text-sm break-words whitespace-pre-wrap">{mail.htmlText}</pre>
        </details>
      )}
    </section>
  );
}
