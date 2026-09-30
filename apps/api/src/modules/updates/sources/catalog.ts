import { db, catalogInstall, catalogItem, catalogRevision, catalogSource } from '@repo/db';
import { eq } from 'drizzle-orm';
import { isNewerVersion, type UpdateCandidate, type UpdateSource } from '@helena/sdk';

// Catalog updates are notices only. The owner opens the catalog, inspects the exact
// new pin and its diff, then adopts it there; the update center never moves a pin.
export const catalogUpdateSource: UpdateSource = {
  id: 'volition-catalog',
  label: 'Katalog',
  kind: 'tool',
  order: 45,
  hosts: ['github.com', 'registry.npmjs.org', 'pypi.org'],
  async check(context) {
    const rows = await db
      .select({
        install: catalogInstall,
        item: catalogItem,
        revision: catalogRevision,
        source: catalogSource,
      })
      .from(catalogInstall)
      .innerJoin(catalogItem, eq(catalogItem.id, catalogInstall.itemId))
      .innerJoin(catalogRevision, eq(catalogRevision.id, catalogInstall.revisionId))
      .innerJoin(catalogSource, eq(catalogSource.id, catalogItem.sourceId));
    const newest = new Map<number, string | null>();
    const candidates: UpdateCandidate[] = [];
    for (const { install, item, revision, source } of rows) {
      if (!source.enabled) continue;
      let available = newest.get(source.id);
      if (available === undefined) {
        try {
          if (source.kind.startsWith('github')) {
            const repository = source.locator.replace('https://github.com/', '');
            let feed = '';
            for (const branch of ['main', 'master']) {
              try {
                feed = await context.fetchText(
                  `https://github.com/${repository}/commits/${branch}.atom`,
                );
                if (feed) break;
              } catch {
                /* try the other conventional default branch */
              }
            }
            available = /\/commit\/([a-f0-9]{40})/i.exec(feed)?.[1] ?? null;
          } else if (source.kind === 'npm-mcp') {
            const metadata = await context.fetchJson<{ version?: string }>(
              `https://registry.npmjs.org/${encodeURIComponent(source.locator)}/latest`,
            );
            available = metadata.version ?? null;
          } else {
            const metadata = await context.fetchJson<{ info?: { version?: string } }>(
              `https://pypi.org/pypi/${encodeURIComponent(source.locator)}/json`,
            );
            available = metadata.info?.version ?? null;
          }
        } catch (error) {
          context.log.warn(`Catalog source ${source.id}: ${String(error)}`);
          available = null;
        }
        newest.set(source.id, available);
      }
      candidates.push({
        component: `${install.teamId}:${item.id}`,
        name: item.name,
        installed: revision.pin,
        available: available ?? null,
        updateAvailable: Boolean(
          available &&
          (source.kind.startsWith('github')
            ? available !== revision.pin.split('@')[0]
            : isNewerVersion(available, revision.pin)),
        ),
        security: false,
        sourceUrl: source.locator,
        applicable: false,
        hint: 'Im Katalog prüfen, Diff ansehen und übernehmen',
        detail: `Team ${install.teamId}, Katalogeintrag ${item.id}; Pin bleibt bis zur Übernahme unverändert`,
      });
    }
    return candidates;
  },
};
