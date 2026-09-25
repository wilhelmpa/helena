// @helena/knowledge: Helena's second brain. The registry of knowledge sources and
// capture targets (the @helena/sdk extension points), the built-in sources, the index
// over all of them, the search, capture, templates and daily notes. The api and the
// worker share it; the web reads it through the api.
export {
  KNOWLEDGE_PLUGIN_MANIFEST,
  knowledgePlugin,
  knowledgeRegistries,
  knowledgeSource,
  knowledgeSources,
  useKnowledgeRegistries,
} from './registry';
export { builtinKnowledgeSources } from './sources';
export { HOME_VAULT_RESOURCE, reindexVaultPaths, vaultSource } from './sources/vault';
export { instanceHome, routes, type InstanceHome } from './sources/common';
export {
  DEFAULT_INDEXER_OPTIONS,
  reindexItems,
  resetSource,
  runSource,
  runSources,
  sourceStates,
  sweepSource,
  type IndexerOptions,
  type SourceRunResult,
} from './indexer';
export { countBySource, removeItems, removeSource, upsertItems } from './store';
export { ANY_RESOURCE, canRead, emptyReach, readableItems, type KnowledgeReach } from './reach';
export {
  linkingItems,
  prefixQuery,
  readIndexedItem,
  recentItems,
  searchKnowledgeIndex,
  tsQuery,
  type LinkedItem,
  type ReadItem,
  type SearchHit,
  type SearchInput,
  type SearchResult,
  type SemanticRetriever,
} from './search';
export {
  appendUnderInbox,
  builtinCaptureTargets,
  captureNote,
  captureToInbox,
  captureToJournal,
  dailyNotePath,
  ensureDailyNote,
  gitAuthorFor,
  inboxFolder,
  INBOX_DIR,
  journalBlock,
  recordActorWrite,
  safeNoteName,
  writeUniqueNote,
  type CaptureActor,
} from './capture';
export {
  DAILY_NOTES_FOLDER,
  dailyNotesConfig,
  DEFAULT_DAILY_NOTES,
  expandTemplate,
  formatDate,
  listTemplates,
  readTemplate,
  seedTemplates,
  templatesFolder,
  type DailyNotesConfig,
  type TemplateInfo,
} from './templates';
export { mentionLinks, parseRef, plainText, taskMentions, taskTarget, vaultTarget } from './text';
export { webNoteText, webPageToNote, type WebPageNote } from './web-capture';
export {
  activeEmbedder,
  chunkText,
  createOpenAiEmbedder,
  createTransformersEmbedder,
  DEFAULT_SEMANTIC_MODEL,
  embedPending,
  ensureVectorIndex,
  hasPgvector,
  normalize,
  saveSemanticSetting,
  semanticRetriever,
  semanticSetting,
  semanticStatus,
  syncEmbedder,
  SEMANTIC_SETTING,
  useEmbedder,
  useEmbeddingRoute,
  type Embedder,
  type EmbeddingRoute,
  type SemanticSetting,
  type SemanticStatus,
} from './vectors';
export { EMBEDDINGS_CLASS, localAiEmbeddingRoute } from './local-embeddings';
