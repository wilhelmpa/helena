import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { isolatedNotesUrl } from '@/utils/vaultLinks';

const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => '';

// Never mount the programmable notes app on Helena's session origin. A frame load
// cannot prove the cross-origin app authenticated; the fallback stays visible.
export default function SilverBulletFrame({ url }: { url: string }) {
  const t = useTranslations('files.unified');
  const [reload, setReload] = useState(0);
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, serverOrigin);
  const [status, setStatus] = useState({ url: '', reload: -1, loaded: false, slow: false });
  const current = status.url === url && status.reload === reload;
  const slow = current && status.slow;
  const loaded = current && status.loaded;
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setStatus((previous) =>
          previous.url === url && previous.reload === reload && previous.loaded
            ? previous
            : { url, reload, loaded: false, slow: true },
        ),
      12000,
    );
    return () => clearTimeout(timer);
  }, [url, reload]);
  const safe = origin ? isolatedNotesUrl(url, origin) : '';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status">
          {!safe
            ? t('isolatedOrigin')
            : slow && !loaded
              ? t('notesSlow')
              : loaded
                ? t('notesHelp')
                : t('loading')}
        </span>
        <Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>
          {t('reload')}
        </Button>
      </div>
      {safe && (
        <iframe
          key={`${safe}:${reload}`}
          src={safe}
          title="SilverBullet"
          className="min-h-[65vh] w-full flex-1 rounded-md border bg-background"
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
          onLoad={() => setStatus({ url, reload, loaded: true, slow: false })}
          onError={() => setStatus({ url, reload, loaded: false, slow: true })}
        />
      )}
    </div>
  );
}
