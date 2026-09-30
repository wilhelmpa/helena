'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import FollowupNotes from '@/components/helena/FollowupNotes';
import { getFollowups, type FollowupTarget } from '@/lib/api/endpoints/agentFollowups';
import { visibleFollowups } from '../../utils/followups';

// The instructions given while one answer ran, under that answer. Read when the answer comes
// near the screen (the API lists them per answer, so a long chat asks only for the answers
// that are shown), from the same cache the open chat's steering writes to: an instruction
// sent or taken over just now shows here at once, and after a reload every answer of the chat
// shows its own.
export default function ChatAnswerFollowups({ target }: { target: FollowupTarget }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = anchor.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  const query = useQuery({
    queryKey: ['agentFollowups', target],
    queryFn: () => getFollowups(target),
    enabled: near,
    staleTime: 30_000,
    retry: false,
  });
  const items = visibleFollowups(query.data?.items ?? []);
  return <div ref={anchor}>{items.length > 0 && <FollowupNotes items={items} />}</div>;
}
