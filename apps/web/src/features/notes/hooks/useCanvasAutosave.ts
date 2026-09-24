import { useEffect, useMemo, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { KEEPALIVE_MAX_BYTES, saveNoteCanvasOnExit } from '@/lib/api/endpoints/noteBoards';
import { useSaveNoteCanvas } from '../services/noteBoards.service';
import type { StickerNodeType } from '../components/StickerNode';
import { toCanvas } from '../utils/noteCanvas';

// 'unsaved' — edits made, not yet persisted (waiting out the debounce);
// 'saving' — the save request is in flight; 'saved'/'error' — its result.
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

// Milliseconds between the last edit and the save request.
const AUTOSAVE_DELAY = 2000;

// Persist the board a while after the last change, reporting the save state so the
// UI can show it. Opening a board does not save it (the initial canvas matches the
// saved snapshot). The host keys the canvas by board id, so one hook instance
// covers one board.
export function useCanvasAutosave(
  projectKey: string,
  boardId: number,
  nodes: StickerNodeType[],
  edges: Edge[],
  enabled: boolean,
): SaveStatus {
  const save = useSaveNoteCanvas(projectKey);
  const saveRef = useRef(save);
  saveRef.current = save;

  const serialized = useMemo(() => JSON.stringify(toCanvas(nodes, edges)), [nodes, edges]);

  // The last canvas that was loaded or saved. A save fires only when the current
  // canvas differs from it — so opening a board does not save (the effect running
  // twice under StrictMode, or React Flow's post-mount node normalization, both
  // leave the serialized canvas unchanged and are ignored).
  const savedSnapshot = useRef(serialized);
  const [status, setStatus] = useState<SaveStatus>('saved');

  // The latest canvas, read by the unmount flush below.
  const latest = useRef({ serialized, boardId, enabled });
  latest.current = { serialized, boardId, enabled };

  useEffect(() => {
    if (!enabled || serialized === savedSnapshot.current) return;
    setStatus('unsaved');
    const timer = setTimeout(() => {
      setStatus('saving');
      saveRef.current.mutate(
        { boardId, canvas: JSON.parse(serialized) },
        {
          onSuccess: () => {
            savedSnapshot.current = serialized;
            setStatus('saved');
          },
          onError: () => setStatus('error'),
        },
      );
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [serialized, boardId, enabled]);

  // Reloading or closing the tab inside the debounce window dropped the edit: no
  // unmount runs then. When the page is hidden (which precedes both) the pending canvas
  // goes out as a keepalive request; one too large for keepalive asks before leaving.
  useEffect(() => {
    const pendingBody = () => {
      const { serialized, enabled } = latest.current;
      if (!enabled || serialized === savedSnapshot.current) return null;
      return JSON.stringify({ canvas: JSON.parse(serialized) });
    };
    const flush = () => {
      const body = pendingBody();
      if (!body || body.length > KEEPALIVE_MAX_BYTES) return;
      const sent = latest.current.serialized;
      void saveNoteCanvasOnExit(projectKey, latest.current.boardId, body)
        .then(() => {
          if (latest.current.serialized === sent) {
            savedSnapshot.current = sent;
            setStatus('saved');
          }
        })
        .catch(() => undefined);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const body = pendingBody();
      if (body && body.length > KEEPALIVE_MAX_BYTES) event.preventDefault();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [projectKey]);

  // Flush a still-pending edit on unmount (switching board, or leaving the page)
  // so a change made inside the debounce window is not dropped. The debounce
  // effect above clears its timer on unmount, so without this the save never fires.
  useEffect(() => {
    return () => {
      const { serialized, boardId, enabled } = latest.current;
      if (enabled && serialized !== savedSnapshot.current) {
        saveRef.current.mutate({ boardId, canvas: JSON.parse(serialized) });
      }
    };
  }, []);

  return status;
}
