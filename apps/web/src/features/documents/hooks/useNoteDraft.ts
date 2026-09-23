import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { VaultDocument } from '@/lib/api/endpoints/knowledge';
import { isApiStatus, useWriteNote } from '../services/knowledge.service';
import type { Frontmatter } from '../utils/noteFrontmatter';
import {
  initialNoteDraft,
  isNoteDirty,
  noteDraftReducer,
  type NoteDraftAction,
  type NoteSnapshot,
} from '../utils/noteDraft';

const AUTOSAVE_DELAY_MS = 700;

const snapshotOf = (document: VaultDocument): NoteSnapshot => ({
  body: document.body,
  frontmatter: document.frontmatter,
});

// The open note's edits and their saving. Writes go out one after another, each with
// the sha the one before returned. The draft is kept in a ref as well, so a write
// reads the latest sha without waiting for a render.
export function useNoteDraft(document: VaultDocument) {
  const t = useTranslations('documents');
  const { mutateAsync: write } = useWriteNote({ quiet: true });
  const [draft, setDraft] = useState(() => initialNoteDraft(document.sha256, snapshotOf(document)));
  const draftRef = useRef(draft);
  const queue = useRef(Promise.resolve(true));
  const mounted = useRef(true);
  const dirty = isNoteDirty(draft);

  const apply = useCallback((action: NoteDraftAction) => {
    draftRef.current = noteDraftReducer(draftRef.current, action);
    setDraft(draftRef.current);
  }, []);

  const saveLatest = useCallback(async () => {
    while (isNoteDirty(draftRef.current) && draftRef.current.status !== 'conflict') {
      const { sha, current } = draftRef.current;
      apply({ type: 'saving' });
      try {
        const written = await write({ path: document.path, ...current, expectedSha: sha });
        apply({ type: 'saved', sha: written.sha256, snapshot: current });
      } catch (error) {
        apply({ type: 'failed', conflict: isApiStatus(error, 409) });
        if (!mounted.current) toast.error(t('saveFailed'));
        return false;
      }
    }
    return draftRef.current.status !== 'conflict';
  }, [apply, document.path, t, write]);

  // Resolves true once nothing is left unsaved.
  const save = useCallback(() => {
    queue.current = queue.current.then(saveLatest);
    return queue.current;
  }, [saveLatest]);

  useEffect(() => {
    apply({ type: 'remote', sha: document.sha256, snapshot: snapshotOf(document) });
  }, [apply, document, draft.status]);

  useEffect(() => {
    if (!dirty || draft.status !== 'saved') return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, save]);

  const unsaved = dirty || draft.status === 'saving';
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Opening another note unmounts the editor before the autosave delay is over.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void save();
    };
  }, [save]);

  const actions = useMemo(
    () => ({
      sha: () => draftRef.current.sha,
      ready: (body: string) => apply({ type: 'ready', body }),
      edit: (body: string) => apply({ type: 'edit', body }),
      setFrontmatter: (frontmatter: Frontmatter) => apply({ type: 'frontmatter', frontmatter }),
      load: (sha: string, snapshot: NoteSnapshot) => apply({ type: 'load', sha, snapshot }),
    }),
    [apply],
  );

  return { draft, dirty, save, ...actions };
}

export type NoteDraftControls = ReturnType<typeof useNoteDraft>;
