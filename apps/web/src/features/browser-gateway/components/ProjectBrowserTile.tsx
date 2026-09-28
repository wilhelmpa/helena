import { useState } from 'react';
import Link from 'next/link';
import { AppWindow, Bot, CircleSlash, Hand, Loader2, Moon, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { browserThumbnailUrl, type RouterBrowserState } from '@/utils/browserOverview';

// One project browser on Home's "Browser" overview (design §5: "eine Kachel pro
// Projekt-Browser (Vorschaubild, URL, wer steuert, Status)"), in the sidebar's surface.
// `state` is null when the browser router did not answer for it.
export default function ProjectBrowserTile({
  name,
  href,
  slug,
  state,
  version,
}: {
  name: string;
  href: string;
  slug: string;
  state: RouterBrowserState | null;
  version: number;
}) {
  const t = useTranslations('browserGateway');
  const relativeTime = useRelativeTime();
  const [broken, setBroken] = useState<number | null>(null);
  const showPicture = !!state?.reachable && !!state.url && broken !== version;
  const control = state?.control;
  const since = control?.since ? relativeTime(new Date(control.since).toISOString()) : null;

  // A project browser runs on demand: one nobody used for a while is stopped, and opening it
  // starts it again. That is not "unreachable".
  const power = state?.power;
  const status =
    power === 'stopped' || power === 'stopping' ? (
      <>
        <Moon className="size-3.5 shrink-0" />
        <span className="truncate">{t('stopped')}</span>
      </>
    ) : power === 'starting' ? (
      <>
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span className="truncate">{t('starting')}</span>
      </>
    ) : !state?.reachable ? (
      <>
        <CircleSlash className="size-3.5 shrink-0" />
        <span className="truncate">{t('unreachable')}</span>
      </>
    ) : control?.by === 'agent' ? (
      <>
        <Bot className="size-3.5 shrink-0" />
        <span className="truncate">
          {control.locked && control.agentName
            ? t('controlledByAgent', { agentName: control.agentName })
            : t('agentActive')}
          {since && ` · ${since}`}
        </span>
      </>
    ) : control?.by === 'owner' ? (
      <>
        <UserRound className="size-3.5 shrink-0" />
        <span className="truncate">
          {t('controlledByOwner')}
          {since && ` · ${since}`}
        </span>
      </>
    ) : (
      <span className="truncate">{t('free')}</span>
    );

  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col overflow-hidden rounded-md border bg-card transition-colors hover:bg-accent"
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden border-b bg-muted text-muted-foreground">
        {showPicture ? (
          // eslint-disable-next-line @next/next/no-img-element -- a live picture from the browser router, not a file Next could optimize.
          <img
            src={browserThumbnailUrl(slug, version)}
            alt=""
            className="size-full object-cover object-top"
            onError={() => setBroken(version)}
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-4 text-center">
            <AppWindow className="size-5" />
            <span className="text-xs">
              {power === 'stopped' || power === 'stopping'
                ? t('stoppedHint')
                : state?.url
                  ? t('noLiveImage')
                  : t('noPage')}
            </span>
          </div>
        )}
        {state?.handover && (
          <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-md bg-warning px-1.5 py-0.5 text-xs font-medium text-background shadow-sm">
            <Hand className="size-3.5" />
            {t('handover')}
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-1 px-3 py-2.5">
        <p className="truncate text-sm font-medium" dir="auto">
          {name}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          dir="auto"
          title={state?.url ?? undefined}
        >
          {state?.title || state?.url || t('noPage')}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{status}</p>
      </div>
    </Link>
  );
}
