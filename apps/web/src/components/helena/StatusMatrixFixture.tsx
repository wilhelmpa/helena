'use client';

import { HELENA_STATUSES, useAgentStatus, type StatusSignals } from '@/utils/helenaStatus';
import Orb from './Orb';
import { Card, MonoLabel, Tile } from './DashboardPrimitives';
import { ProjectTag } from './ProjectTag';

const surfaces = [
  'Home',
  'Chat',
  'Agentenwahl',
  'Sidebar',
  'Team',
  'Kreis',
  'Inbox',
  'Board',
  'Dashboard',
] as const;

const signals: StatusSignals[] = [
  {},
  { voicePhase: 'listening' },
  { run: 'running' },
  { tool: true },
  { voicePhase: 'speaking' },
  { awaitingChoice: true },
  { run: 'failed' },
  { budget: 'exhausted' },
  { runtimeStatus: 'offline' },
  { run: 'done' },
];

function MatrixCell({
  surface,
  input,
}: {
  surface: (typeof surfaces)[number];
  input: StatusSignals;
}) {
  const status = useAgentStatus(0, input);
  const orb = (size: 'large' | 'small' | 'dot') => (
    <Orb
      state={status}
      size={size}
      motionEnabled={false}
      className={size === 'large' ? '[--orb-size:76px]' : ''}
    />
  );
  let sample;
  switch (surface) {
    case 'Home':
      sample = <div className="mx-auto">{orb('large')}</div>;
      break;
    case 'Chat':
      sample = (
        <div className="flex items-center gap-2">
          {orb('small')}
          <span>{'Helena'}</span>
        </div>
      );
      break;
    case 'Agentenwahl':
      sample = (
        <div className="flex items-center gap-2 rounded-full bg-[var(--dashboard-raised)] px-2 py-1">
          {orb('dot')}
          <span>{'Home · Claude'}</span>
        </div>
      );
      break;
    case 'Sidebar':
      sample = (
        <div className="flex items-center gap-2">
          {orb('dot')}
          <span>{'Agent'}</span>
        </div>
      );
      break;
    case 'Team':
      sample = (
        <div className="flex items-center gap-2">
          {orb('small')}
          <span>{'Agent'}</span>
        </div>
      );
      break;
    case 'Kreis':
      sample = (
        <div className="mx-auto rounded-full bg-[var(--dashboard-raised)] p-3">{orb('small')}</div>
      );
      break;
    case 'Inbox':
      sample = (
        <div className="flex items-start gap-2">
          {orb('dot')}
          <div>
            <ProjectTag projectKey="TRADE" plain />
            <div>{'Freigabe'}</div>
          </div>
        </div>
      );
      break;
    case 'Board':
      sample = (
        <div className="flex items-center gap-2">
          <ProjectTag projectKey="TRADE" plain />
          <span>{'Aufgabe'}</span>
          {orb('dot')}
        </div>
      );
      break;
    case 'Dashboard':
      sample = (
        <Tile
          label="Agenten arbeiten"
          value={status === 'thinking' || status === 'tool' ? '1' : '0'}
          status={orb('dot')}
        />
      );
      break;
  }
  return (
    <div data-surface={surface} data-status={status} className="min-w-0">
      <Card as="div" className="flex h-[98px] min-w-0 items-center rounded-xl px-3 text-xs">
        {sample}
      </Card>
    </div>
  );
}

export default function StatusMatrixFixture() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground" data-status-matrix>
      <div className="grid min-w-[1600px] grid-cols-[110px_repeat(9,minmax(0,1fr))] gap-2">
        <div />
        {surfaces.map((surface) => (
          <MonoLabel key={surface}>{surface}</MonoLabel>
        ))}
        {HELENA_STATUSES.map((status, index) => (
          <div key={status} className="contents" data-status-row={status}>
            <MonoLabel className="self-center">{status}</MonoLabel>
            {surfaces.map((surface) => (
              <MatrixCell key={`${status}:${surface}`} surface={surface} input={signals[index]!} />
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
