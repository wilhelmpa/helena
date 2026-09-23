import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { SyncServer } from '@/lib/api/endpoints/deviceSync';
import { copyText } from '../utils/copyText';
import DevicesSection from './DevicesSection';

export default function DevicesServerCard({ server }: { server: SyncServer }) {
  const t = useTranslations('devices.server');
  const tCommon = useTranslations('common');

  async function copy() {
    if (await copyText(server.deviceId).catch(() => false)) toast.success(t('copied'));
    else toast.error(t('copyFailed'));
  }

  return (
    <DevicesSection title={t('title')} hint={t('hint')}>
      <div className="flex flex-wrap items-start gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the API, not a file Next could optimise. */}
        <img
          src={server.qrCode}
          alt={t('qrAlt')}
          width={160}
          height={160}
          className="rounded-md bg-white p-2 [image-rendering:pixelated]"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all select-all"
            >
              {server.deviceId}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy className="size-4" />
              {tCommon('copy')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('version', { version: server.version })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(server.globalDiscovery && server.relays ? 'discoveryOn' : 'discoveryOff')}
          </p>
        </div>
      </div>
    </DevicesSection>
  );
}
