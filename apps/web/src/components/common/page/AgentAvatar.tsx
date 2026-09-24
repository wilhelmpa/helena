import Avatar from '@/components/common/Avatar';
import { cn } from '@/lib/utils';
import type { Status } from './StatusBadge';

// Which engine runs the agent. Shown as a short monospace code, the same convention
// the sidebar uses for project keys and issue IDs — never a third-party logo.
export type AgentRuntime = 'hermes' | 'claude' | 'codex' | 'external';

const RUNTIME_LABEL: Record<AgentRuntime, string> = {
  hermes: 'Hermes',
  claude: 'Claude',
  codex: 'Codex',
  external: 'External',
};

const RUNTIME_CODE: Record<AgentRuntime, string> = {
  hermes: 'H',
  claude: 'CC',
  codex: 'CX',
  external: 'EX',
};

// arbeitet / wartet / bereit / offline (docs/volition-design-helena-ui.md "Agenten").
// Maps onto the shared Status vocabulary so the dot always matches StatusBadge
// elsewhere on the same page.
export type AgentPresence = 'running' | 'waiting' | 'ready' | 'offline';

const PRESENCE_STATUS: Record<AgentPresence, Status> = {
  running: 'running',
  waiting: 'waiting',
  ready: 'success',
  offline: 'idle',
};

const PRESENCE_DOT: Record<AgentPresence, string> = {
  running: 'bg-status-running',
  waiting: 'bg-status-waiting',
  ready: 'bg-status-success',
  offline: 'bg-status-idle',
};

// An agent's avatar: the same photo-or-initials circle a person gets (Avatar), plus a
// runtime chip (which engine runs it) and a presence dot. Sized like Avatar — pass a
// size-* className on the wrapper; the corner marks are proportioned for the size-6
// to size-10 range this app uses for agent avatars (cards, lists, the org chart).
export default function AgentAvatar({
  name,
  image,
  runtime,
  presence,
  className,
}: {
  name: string;
  image?: string | null;
  runtime?: AgentRuntime;
  presence?: AgentPresence;
  className?: string;
}) {
  return (
    <span
      data-slot="agent-avatar"
      className={cn('relative inline-flex size-5 shrink-0', className)}
    >
      <Avatar name={name} image={image} className="size-full" />
      {presence && (
        <span
          className="absolute -end-0.5 -top-0.5 flex size-2 items-center justify-center rounded-full bg-background ring-2 ring-background"
          title={presence}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              PRESENCE_DOT[presence],
              presence === 'running' && 'animate-pulse motion-reduce:animate-none',
            )}
          />
        </span>
      )}
      {runtime && (
        <span
          data-slot="agent-avatar-runtime"
          className="absolute -end-1 -bottom-1 rounded-sm border border-border bg-background px-0.5 font-mono leading-tight font-semibold text-muted-foreground"
          title={RUNTIME_LABEL[runtime]}
        >
          {RUNTIME_CODE[runtime]}
        </span>
      )}
    </span>
  );
}

// Re-exported so a caller that already has a Status (from an agent's run) can map it
// straight to a presence without re-deriving it.
export { PRESENCE_STATUS };
