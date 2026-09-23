import Link from 'next/link';
import { AppWindow, Bot, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { projectPath } from '@/utils/paths';

// Who has control of a project browser right now: an agent, by name, or the owner. Null
// means the live control state is not known yet (see the component doc below).
export type ProjectBrowserControlledBy = { kind: 'agent'; agentName: string } | { kind: 'owner' };

// One project's browser on Home's "Browser" overview (design §5: "eine Kachel pro
// Projekt-Browser (Vorschaubild, URL, wer steuert, Status)"), in the same card style as
// HomeProjectCard. `url`, `controlledBy` and `thumbnailUrl` are deliberately optional/
// nullable: the browser router that will serve them is still being built (see
// docs/volition-design-browser-gateway.md §3, §5), so today's overview API
// (GET /browser-gateway/overview) only carries the project's identity and every tile
// renders its neutral placeholders. Wiring in the live values later is then a matter of
// passing real props here, not a rewrite of the tile.
export default function ProjectBrowserTile({
  projectKey,
  projectName,
  url,
  controlledBy,
  thumbnailUrl,
}: {
  projectKey: string;
  projectName: string;
  url: string | null;
  controlledBy: ProjectBrowserControlledBy | null;
  thumbnailUrl: string | null;
}) {
  const t = useTranslations('browserGateway');

  return (
    <Link
      href={projectPath(projectKey)}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/40"
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted text-muted-foreground">
        {thumbnailUrl ? (
          // browser router, not a Next-optimizable static asset.
          <img src={thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-4 text-center">
            <AppWindow className="size-6" />
            <span className="text-xs">{t('noLiveImage')}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-1.5 p-3">
        <h2 className="min-w-0 truncate text-sm font-semibold" dir="auto">
          {projectName}
        </h2>
        <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
          {url ?? t('noUrl')}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {controlledBy?.kind === 'agent' ? (
            <>
              <Bot className="size-3.5 shrink-0" />
              <span className="truncate">
                {t('controlledByAgent', { agentName: controlledBy.agentName })}
              </span>
            </>
          ) : controlledBy?.kind === 'owner' ? (
            <>
              <UserRound className="size-3.5 shrink-0" />
              <span className="truncate">{t('controlledByOwner')}</span>
            </>
          ) : (
            <span className="truncate">{t('controlledByUnknown')}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
