import { useCallback, useEffect, useRef, useState } from 'react';
import { isPageInput, type LiveControlState, type LiveMessage } from '@/utils/browserLive';

// The owner's side of the control lock in the live view (design §5):
// - while an agent controls the browser, the owner's first press or key does not reach the
//   page but asks whether to take over ("Übernehmen?"), so the two never act at once;
// - while the owner controls it, 10 minutes without any input from them ask whether they
//   are done, and a minute without an answer gives control back.
const OWNER_IDLE_MS = 10 * 60_000;
const IDLE_ANSWER_MS = 60_000;
const CHECK_MS = 15_000;

export type ControlPrompt = 'takeOver' | 'idle' | null;

function startsInput(message: LiveMessage): boolean {
  if (message.type === 'mouse') return message.event === 'down' || message.event === 'click';
  if (message.type === 'key') return message.event === 'down';
  return message.type === 'text';
}

export function useBrowserControlGate(
  control: LiveControlState,
  send: (message: LiveMessage) => void,
  release: () => void,
) {
  const [prompt, setPrompt] = useState<ControlPrompt>(null);
  const lastInput = useRef(0);
  const promptedAt = useRef(0);
  const agentHolds = control.locked && control.by === 'agent';
  const ownerHolds = control.locked && control.by === 'owner';

  const guardedSend = useCallback(
    (message: LiveMessage) => {
      if (isPageInput(message)) {
        if (agentHolds) {
          if (startsInput(message)) setPrompt('takeOver');
          return;
        }
        lastInput.current = Date.now();
        // An old question from an agent's earlier turn is not asked again later.
        setPrompt((current) => (current === 'takeOver' ? null : current));
      }
      send(message);
    },
    [agentHolds, send],
  );

  // A prompt that no longer fits what the lock says is not shown.
  const shown: ControlPrompt =
    (prompt === 'takeOver' && !agentHolds) || (prompt === 'idle' && !ownerHolds) ? null : prompt;
  const promptRef = useRef<ControlPrompt>(null);
  useEffect(() => {
    promptRef.current = shown;
  }, [shown]);

  useEffect(() => {
    if (!ownerHolds) return;
    const timer = setInterval(() => {
      const now = Date.now();
      if (promptRef.current === 'idle') {
        if (now - promptedAt.current > IDLE_ANSWER_MS) {
          setPrompt(null);
          release();
        }
        return;
      }
      const quietSince = Math.max(lastInput.current, control.since ?? 0);
      if (promptRef.current === null && now - quietSince > OWNER_IDLE_MS) {
        promptedAt.current = now;
        setPrompt('idle');
      }
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [control.since, ownerHolds, release]);

  const dismiss = useCallback(() => {
    // "Weiter steuern" counts as input.
    lastInput.current = Date.now();
    setPrompt(null);
  }, []);

  return { guardedSend, prompt: shown, dismiss };
}
