'use client';

import { EmbedConnecting, EmbedProblem } from '@/design-system';
import { useFrameGuard } from '@/hooks/useFrameGuard';

// One tab of the owner terminal: its frame only once the terminal answers, Ava's own view
// when it does not (router down, the grant gone), reconnecting by itself (Auftrag 116).
export default function OwnerTerminalFrame({
  src,
  title,
  active,
  frameRef,
  onLoaded,
  onClose,
}: {
  src: string;
  title: string;
  active: boolean;
  frameRef: (element: HTMLIFrameElement | null) => void;
  onLoaded: (frame: HTMLIFrameElement) => void;
  onClose: () => void;
}) {
  const guard = useFrameGuard({ url: src, active });
  if (!guard.showFrame) {
    if (!active) return null;
    return (
      <div className="ds-terminal-frame" data-active="true">
        {guard.state.phase === 'failed' ? (
          <EmbedProblem
            tool={title}
            reason={guard.state.reason}
            status={guard.state.status}
            retrying={guard.state.retrying}
            onReload={guard.retry}
            onClose={onClose}
          />
        ) : (
          <EmbedConnecting tool={title} />
        )}
      </div>
    );
  }
  return (
    <iframe
      key={guard.session}
      ref={frameRef}
      src={src}
      title={title}
      loading="lazy"
      className="ds-terminal-frame"
      data-active={active ? 'true' : 'false'}
      allow="clipboard-read; clipboard-write"
      onLoad={(event) => {
        guard.onLoad(event.currentTarget);
        onLoaded(event.currentTarget);
      }}
    />
  );
}
