import { useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

const STEPS = [0.5, 1, 1.5, 2, 3, 4];

// An image at the size of the dialog, or zoomed in steps and scrolled.
export default function FileViewerImage({ url, name }: { url: string; name: string }) {
  const t = useTranslations('files.viewer');
  const [step, setStep] = useState<number | null>(null);
  const scale = step === null ? null : STEPS[step];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('zoomOut')}
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, (current ?? 1) - 1))}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('zoomReset')}
          onClick={() => setStep(null)}
        >
          <Scan />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('zoomIn')}
          disabled={step === STEPS.length - 1}
          onClick={() => setStep((current) => Math.min(STEPS.length - 1, (current ?? 1) + 1))}
        >
          <Plus />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-md bg-muted/40">
        {/* Not next/image: the bytes come through the session proxy and are not optimized. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          className={scale === null ? 'max-h-[70vh] max-w-full object-contain' : 'max-w-none'}
          style={scale === null ? undefined : { width: `${scale * 100}%` }}
        />
      </div>
    </div>
  );
}
