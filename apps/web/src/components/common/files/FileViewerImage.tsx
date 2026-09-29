'use client';

import { useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconButton, Inline } from '@/design-system';

const STEPS = [0.5, 1, 1.5, 2, 3, 4];

// An image at the size of the overlay, or zoomed in steps and scrolled, on the one surface
// the other viewers sit on (O75).
export default function FileViewerImage({ url, name }: { url: string; name: string }) {
  const t = useTranslations('files.viewer');
  const [step, setStep] = useState<number | null>(null);
  const scale = step === null ? null : STEPS[step];

  return (
    <div className="ds-file-image">
      <Inline gap={1} justify="end">
        <IconButton
          size="small"
          label={t('zoomOut')}
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, (current ?? 1) - 1))}
        >
          <Minus />
        </IconButton>
        <IconButton size="small" label={t('zoomReset')} onClick={() => setStep(null)}>
          <Scan />
        </IconButton>
        <IconButton
          size="small"
          label={t('zoomIn')}
          disabled={step === STEPS.length - 1}
          onClick={() => setStep((current) => Math.min(STEPS.length - 1, (current ?? 1) + 1))}
        >
          <Plus />
        </IconButton>
      </Inline>
      <div className="ds-file-image-stage">
        {/* Not next/image: the bytes come through the session proxy and are not optimized. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          className="ds-file-image-img"
          data-zoomed={scale === null ? undefined : ''}
          style={scale === null ? undefined : { width: `${scale * 100}%` }}
        />
      </div>
    </div>
  );
}
