import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { editMarkdownSource } from '../utils/editMarkdownSource';

export default function VaultMarkdownSource({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('files.unified');
  const [rejected, setRejected] = useState(false);
  return (
    <>
      <Textarea
        aria-label={t('source')}
        className="min-h-[55vh] flex-1 resize-none font-mono"
        value={value}
        readOnly={!editable}
        onChange={(event) => {
          if (!editable) return;
          const updated = editMarkdownSource(value, event.target.value);
          setRejected(updated === null);
          if (updated !== null) onChange(updated);
        }}
      />
      {rejected && <p role="alert">{t('sourceEditRejected')}</p>}
    </>
  );
}
