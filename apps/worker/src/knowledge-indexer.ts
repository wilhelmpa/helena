import { asc, eq } from 'drizzle-orm';
import { db, user, userPreference } from '@repo/db';
import type { PluginHost } from '@helena/sdk/server';
import {
  embedPending,
  ensureVectorIndex,
  KNOWLEDGE_PLUGIN_MANIFEST,
  knowledgePlugin,
  knowledgeSources,
  runSources,
  seedTemplates,
  syncEmbedder,
  useKnowledgeRegistries,
  type Embedder,
} from '@helena/knowledge';
import { startPollLoop, type WorkerHandle } from './poll-loop';

// The second brain's index in the worker: every few seconds each registered knowledge
// source is asked what changed (@helena/knowledge indexer), and while semantic search is
// on, new passages are embedded. On start it seeds the note templates and Obsidian's
// daily-note settings into the vault once.

const INDEX_INTERVAL_MS = Number(process.env.KNOWLEDGE_INDEX_INTERVAL_MS) || 5_000;
const EMBED_INTERVAL_MS = 10_000;

async function instanceLanguage(): Promise<'de' | 'en'> {
  const [owner] = await db
    .select({ locale: userPreference.locale })
    .from(user)
    .leftJoin(userPreference, eq(userPreference.userId, user.id))
    .where(eq(user.role, 'god'))
    .orderBy(asc(user.createdAt))
    .limit(1);
  return owner?.locale?.startsWith('de') ? 'de' : 'en';
}

export async function startKnowledgeIndexer(options: {
  vault: boolean;
  host: PluginHost;
}): Promise<WorkerHandle> {
  // Helena's own sources are the internal plugin `helena.knowledge`, in the host's
  // registries beside those of plugins.
  useKnowledgeRegistries({
    sources: options.host.knowledgeSources,
    captureTargets: options.host.captureTargets,
  });
  const loaded = await options.host.load(knowledgePlugin, KNOWLEDGE_PLUGIN_MANIFEST);
  if (loaded.status !== 'loaded') console.error(`[knowledge] plugin failed: ${loaded.error}`);
  if (options.vault) {
    void (async () => {
      try {
        const written = await seedTemplates(await instanceLanguage());
        if (written.length > 0) console.log(`[knowledge] seeded ${written.length} templates`);
      } catch (error) {
        console.error('[knowledge] seeding the templates failed:', error);
      }
    })();
  }
  const index = startPollLoop(
    'knowledge',
    async () => {
      for (const result of await runSources(knowledgeSources())) {
        if (result.error) console.error(`[knowledge] ${result.source}: ${result.error}`);
      }
    },
    () => INDEX_INTERVAL_MS,
  );
  let indexed: Embedder | null = null;
  const embed = startPollLoop(
    'knowledge-embed',
    async () => {
      const embedder = await syncEmbedder();
      if (!embedder) return;
      if (indexed !== embedder) {
        await ensureVectorIndex(embedder.dims);
        indexed = embedder;
      }
      while ((await embedPending(embedder)) > 0) {
        // Keep going while passages wait.
      }
    },
    () => EMBED_INTERVAL_MS,
  );
  return {
    stop() {
      index.stop();
      embed.stop();
    },
  };
}
