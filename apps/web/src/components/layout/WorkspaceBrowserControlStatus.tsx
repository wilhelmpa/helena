'use client';

import { useEffect, useState } from 'react';
import { useBrowserLock } from '@/hooks/useBrowserLock';
import { FREE_CONTROL, screencastUrl, type LiveControlState } from '@/utils/browserLive';
import WorkspaceBrowserControl from './WorkspaceBrowserControl';

// The desktop iframe does not use WorkspaceBrowserLive's socket. Observe only the
// control messages, with the viewer hidden so the router sends no image frames.
export default function WorkspaceBrowserControlStatus({ base }: { base: string }) {
  const [control, setControl] = useState<LiveControlState>(FREE_CONTROL);
  const { takeOver, takingOver, release, releasing } = useBrowserLock(base);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      socket = new WebSocket(screencastUrl(base));
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'hidden', hidden: true }));
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as { type?: string } & Partial<LiveControlState>;
          if (
            message.type === 'control' &&
            (message.by === 'agent' || message.by === 'owner' || message.by === 'free')
          ) {
            setControl({
              by: message.by,
              agentName: message.agentName ?? null,
              since: message.since ?? null,
              locked: message.locked === true,
            });
          }
        } catch {
          // Other text messages belong to the stream and do not affect the lock.
        }
      };
      socket.onclose = () => {
        setControl(FREE_CONTROL);
        if (!stopped) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [base]);

  return (
    <WorkspaceBrowserControl
      control={control}
      busy={takingOver || releasing}
      inline
      onTakeOver={takeOver}
      onHandBack={release}
    />
  );
}
