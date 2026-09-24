import type { HelenaEvent } from './events';
import type { LocalizedText } from './text';

// The second brain: everything Helena holds that a person or an agent may want to find
// again. Each kind of thing is a knowledge source (tasks, comments, docs, files, mail,
// chats, run transcripts, web captures, a plugin's own). A source only says how to
// enumerate its items, read one, tell which items an event changed, and resolve a link;
// the indexer (one per instance) turns items into a single search with one ACL model.

// Who may see an item. The indexer filters every search by it, so a source must set it
// from the item's real access rule, never wider.
export interface KnowledgeScope {
  teamId: number;
  // Null for team-wide items (Home docs, team mail).
  projectId: number | null;
  // `private` items are visible to `ownerId` only (a personal note, a private chat).
  visibility: 'project' | 'team' | 'private';
  ownerId?: string | null;
}

// Where an item came from, for the "why do I see this" line and for trust: an agent's
// run output reads differently from a doc a person wrote.
export interface KnowledgeProvenance {
  createdAt: string;
  updatedAt: string;
  // `user:<id>`, `agent:<id>`, `system`, `plugin:<id>`.
  author?: string | null;
  // The outside origin: the page a web capture was taken from, a mail's Message-ID.
  origin?: string | null;
  runId?: number | null;
}

export type KnowledgeLinkKind = 'mentions' | 'parent' | 'attachment' | 'reply' | 'related';

export interface KnowledgeLink {
  // Another item as `<source>:<id>`, or an outside URL.
  target: string;
  kind: KnowledgeLinkKind;
}

export type KnowledgeMetadataValue = string | number | boolean | string[] | null;

export interface KnowledgeItem {
  // Unique within the source: `481`, `Projects/VOL/Docs/plan.md`.
  id: string;
  title: string;
  // The indexable text, plain or Markdown. Binary content arrives here already
  // extracted (PDF text, OCR).
  text: string;
  // Where the item opens in Helena (a route), or an outside URL.
  href: string;
  mimeType?: string;
  language?: string;
  scope: KnowledgeScope;
  provenance: KnowledgeProvenance;
  metadata?: Record<string, KnowledgeMetadataValue>;
  links?: KnowledgeLink[];
}

export interface KnowledgeListContext {
  teamId?: number;
  projectId?: number | null;
  // Only items changed since then, for a catch-up after downtime.
  since?: Date | null;
  cursor?: string | null;
  limit: number;
  signal?: AbortSignal;
}

export interface KnowledgeSource {
  id: string;
  label: LocalizedText;
  icon?: string;
  // Pages through every item, for a full index or a catch-up.
  list(ctx: KnowledgeListContext): Promise<{ items: KnowledgeItem[]; cursor: string | null }>;
  // One item as it is now, or null when it is gone.
  get(id: string): Promise<KnowledgeItem | null>;
  // Incremental indexing: the event types that change this source's items, and which
  // items one of them touched. Deleted items come back null from get().
  events?: {
    types: string[];
    itemIds(event: HelenaEvent): string[];
  };
  // Resolves a reference written in text (`VOL-42`, `[[Plan]]`) to an item id of this
  // source, for links between items.
  resolveLink?(
    ref: string,
    scope: { teamId: number; projectId: number | null },
  ): Promise<string | null>;
}

// "Save to knowledge": what a surface (chat, browser, mail, task) hands over, and a
// target that stores it (the vault inbox, a project's docs, a plugin's store). Surfaces
// offer the registered targets through the `capture-action` UI slot.
export type CaptureKind = 'text' | 'chat-message' | 'web-page' | 'mail-message' | 'issue' | 'file';

export interface CaptureInput {
  kind: CaptureKind;
  title: string;
  // Markdown.
  text: string;
  // The page, the chat, the mail the capture was taken from.
  origin?: string | null;
  // The Helena item it came from, `<source>:<id>`.
  from?: string | null;
  teamId: number;
  projectId: number | null;
  tags?: string[];
}

export interface CaptureResult {
  // The new item as `<source>:<id>`.
  item: string;
  href: string;
}

export interface CaptureTarget {
  id: string;
  label: LocalizedText;
  icon?: string;
  accepts: CaptureKind[];
  capture(input: CaptureInput, ctx: { actor: string }): Promise<CaptureResult>;
}
