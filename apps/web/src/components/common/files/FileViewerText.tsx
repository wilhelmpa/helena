import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { highlightAs } from '@/lib/highlight';
import { highlightLanguage } from '@/utils/fileKinds';

const MAX_TEXT_BYTES = 1024 * 1024;

// A text file as it is, highlighted in the language its name stands for.
export default function FileViewerText({
  url,
  name,
  sizeBytes,
}: {
  url: string;
  name: string;
  sizeBytes: number | null;
}) {
  const t = useTranslations('files.viewer');
  const tooLarge = sizeBytes !== null && sizeBytes > MAX_TEXT_BYTES;
  const text = useQuery({
    queryKey: ['files', 'text', url],
    queryFn: async () => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      return res.text();
    },
    enabled: !tooLarge,
    retry: false,
  });

  if (tooLarge) return <p className="text-sm text-muted-foreground">{t('tooLarge')}</p>;
  if (text.isPending) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (text.isError) return <p className="text-sm text-destructive">{t('error')}</p>;
  const language = highlightLanguage(name);
  const highlighted = language ? highlightAs(language, text.data) : null;
  return (
    <div className="md-content min-h-0 flex-1 overflow-auto" dir="ltr">
      <pre className="text-xs leading-5 whitespace-pre-wrap">
        <code>{highlighted ?? text.data}</code>
      </pre>
    </div>
  );
}
