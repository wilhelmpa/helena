import type { Frontmatter } from './noteFrontmatter';

// The edits of one open note against the file.
//
// The canvas reports the original body after checking its Markdown round trip.
// Until then `saved` is null, so mounting cannot start an autosave.

export type NoteSaveStatus = 'saved' | 'saving' | 'error' | 'conflict';

export interface NoteSnapshot {
  body: string;
  frontmatter: Frontmatter;
}

export interface NoteDraft {
  sha: string;
  // Every sha this editor loaded or wrote. A refetch that brings one of them is not a
  // change made elsewhere.
  knownShas: string[];
  // What the editor was mounted with; a new revision remounts it.
  loaded: NoteSnapshot & { revision: number };
  // Null until the mounted editor reported its serialization of `loaded`.
  saved: NoteSnapshot | null;
  current: NoteSnapshot;
  status: NoteSaveStatus;
}

export type NoteDraftAction =
  | { type: 'load'; sha: string; snapshot: NoteSnapshot }
  | { type: 'ready'; body: string }
  | { type: 'edit'; body: string }
  | { type: 'frontmatter'; frontmatter: Frontmatter }
  | { type: 'saving' }
  | { type: 'saved'; sha: string; snapshot: NoteSnapshot }
  | { type: 'failed'; conflict: boolean }
  | { type: 'remote'; sha: string; snapshot: NoteSnapshot };

export function initialNoteDraft(sha: string, snapshot: NoteSnapshot): NoteDraft {
  return {
    sha,
    knownShas: [sha],
    loaded: { ...snapshot, revision: 0 },
    saved: null,
    current: snapshot,
    status: 'saved',
  };
}

const sameFrontmatter = (a: Frontmatter, b: Frontmatter) => JSON.stringify(a) === JSON.stringify(b);

export function isNoteDirty(draft: NoteDraft): boolean {
  return (
    draft.saved !== null &&
    (draft.current.body !== draft.saved.body ||
      !sameFrontmatter(draft.current.frontmatter, draft.saved.frontmatter))
  );
}

// The frontmatter "Keep mine" writes over their version: mine when I changed it,
// otherwise theirs, so a property they added is kept.
export function frontmatterToKeep(draft: NoteDraft, theirs: Frontmatter): Frontmatter {
  const changed =
    draft.saved !== null && !sameFrontmatter(draft.current.frontmatter, draft.saved.frontmatter);
  return changed ? draft.current.frontmatter : theirs;
}

function load(draft: NoteDraft, sha: string, snapshot: NoteSnapshot): NoteDraft {
  return {
    sha,
    knownShas: draft.knownShas.includes(sha) ? draft.knownShas : [...draft.knownShas, sha],
    loaded: { ...snapshot, revision: draft.loaded.revision + 1 },
    saved: null,
    current: snapshot,
    status: 'saved',
  };
}

export function noteDraftReducer(draft: NoteDraft, action: NoteDraftAction): NoteDraft {
  switch (action.type) {
    case 'load':
      return load(draft, action.sha, action.snapshot);
    case 'ready':
      return {
        ...draft,
        saved: { body: action.body, frontmatter: draft.loaded.frontmatter },
        current: { ...draft.current, body: action.body },
      };
    case 'edit':
    case 'frontmatter': {
      const current =
        action.type === 'edit'
          ? { ...draft.current, body: action.body }
          : { ...draft.current, frontmatter: action.frontmatter };
      return { ...draft, current, status: draft.status === 'error' ? 'saved' : draft.status };
    }
    case 'saving':
      return { ...draft, status: 'saving' };
    case 'saved':
      return {
        ...draft,
        sha: action.sha,
        knownShas: [...draft.knownShas, action.sha],
        saved: action.snapshot,
        status: 'saved',
      };
    case 'failed':
      return { ...draft, status: action.conflict ? 'conflict' : 'error' };
    case 'remote':
      // While a save is out, its own sha may come back before its response does.
      if (
        draft.status === 'saving' ||
        draft.status === 'conflict' ||
        draft.knownShas.includes(action.sha)
      ) {
        return draft;
      }
      if (isNoteDirty(draft)) return { ...draft, status: 'conflict' };
      return load(draft, action.sha, action.snapshot);
  }
}
