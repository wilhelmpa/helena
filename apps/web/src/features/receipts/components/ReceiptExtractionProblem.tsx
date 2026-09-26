'use client';

import { useTranslations } from 'next-intl';

export default function ReceiptExtractionProblem({ error }: { error: string }) {
  const t = useTranslations('receipts.problems');
  let text = error;
  if (error.startsWith('missing_programs:'))
    text = t('missingPrograms', { programs: error.slice('missing_programs:'.length).trim() });
  else if (error === 'not_einvoice') text = t('notEinvoice');
  else if (error === 'no_facts') text = t('noFacts');
  return <p>{text}</p>;
}
