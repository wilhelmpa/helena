import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';

// Covers the browser while files from the computer are dragged over it.
export default function FileDropOverlay({ folder }: { folder: string }) {
  const t = useTranslations('files');
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-background/80 text-primary backdrop-blur-sm">
      <Upload className="size-6" />
      <span className="text-sm font-medium">{t('dropToUpload', { folder })}</span>
    </div>
  );
}
