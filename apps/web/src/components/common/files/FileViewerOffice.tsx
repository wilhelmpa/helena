import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { extractedText } from '@/lib/api/endpoints/projectFiles';

// An office file cannot be shown in the browser. What the vault index extracted from it
// is shown instead, once the index has it.
export default function FileViewerOffice({ vaultPath }: { vaultPath: string | null }) {
  const t = useTranslations('files.viewer');
  const text = useQuery({
    queryKey: ['files', 'extracted', vaultPath],
    queryFn: () => extractedText(vaultPath!),
    enabled: vaultPath !== null,
    retry: false,
  });

  if (vaultPath !== null && text.isPending) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (!text.data) return <p className="text-sm text-muted-foreground">{t('noExtracted')}</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{t('extracted')}</p>
      <p className="text-sm whitespace-pre-wrap" dir="auto">
        {text.data}
      </p>
    </div>
  );
}
