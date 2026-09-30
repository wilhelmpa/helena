import { readFile } from 'node:fs/promises';
import type { ModelServerRow } from '@repo/db';
import { parseLocalModelId } from '@helena/sdk';
import { LOCAL_PROFILES, NPU_CHAT_MODELS, NPU_EMBED } from './npu-profile';
import type { WatchedModel } from './model-watch';

const native = new URL('../../../../../deployment/volition-stack/native/', import.meta.url);
async function rows(path: string) {
  return (await readFile(new URL(path, native), 'utf8'))
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'));
}

export async function configuredModelWatch(
  servers: ModelServerRow[],
  selected: string[],
  inventory: Record<string, unknown> | null,
): Promise<WatchedModel[]> {
  const [models, voice, halogen] = await Promise.all([
    rows('local-ai/models.tsv'),
    rows('local-ai/voice-models.tsv'),
    rows('halogen/files.tsv'),
  ]);
  const catalog = new Map<string, WatchedModel>();
  for (const row of models) {
    const flm = row[1] === 'flm';
    const source = {
      name: row[0]!,
      repo: row[3]!,
      revision: row[4]!,
      files: row[5]!.split(','),
      bytes: Number(row[7]),
    };
    if (flm) {
      source.repo = source.files[0]!.split(':')[0]!;
      source.files = source.files.map((file) => file.split(':')[1]!);
      catalog.set(row[3]!, source);
    }
    catalog.set(row[0]!, source);
  }
  for (const row of voice)
    catalog.set(row[0]!, {
      name: row[0]!,
      repo: row[2]!,
      revision: row[3]!,
      files: [row[8]!],
      localFiles: [row[4]!],
      bytes: Number(row[5]),
    });

  const watches = new Map<string, WatchedModel>();
  const add = (entry: WatchedModel) => {
    const key = entry.repo ?? entry.name;
    const previous = watches.get(key);
    if (previous) {
      if (entry.files.every((file) => previous.files.includes(file))) return;
      previous.files = [...new Set([...previous.files, ...entry.files])];
      previous.bytes += entry.bytes;
    } else watches.set(key, structuredClone(entry));
  };
  const addNamed = (id: string) =>
    add(catalog.get(id) ?? { name: id, repo: null, revision: null, files: [], bytes: 0 });
  const hasProfile = (id: string) => LOCAL_PROFILES.some((profile) => profile.model === id);
  const choices = selected.map(parseLocalModelId).filter((value) => value !== null);
  for (const server of servers) {
    if (server.kind === 'halogen' && (server.enabled || hasProfile(server.models[0]?.id ?? ''))) {
      for (const row of halogen)
        add({
          name: server.name,
          repo: row[1]!,
          revision: row[2]!,
          files: [row[3]!],
          bytes: Number(row[4]),
        });
    }
    for (const model of server.models) {
      if (server.kind === 'halogen') continue;
      if (['whisper-cpp', 'qwentts-cpp'].includes(server.kind) && !model.checkpoint) continue;
      const chosen = choices.some(
        (value) => value.slug === server.slug && value.model === model.id,
      );
      if (
        !chosen &&
        !hasProfile(model.id) &&
        !(server.enabled && (model.loaded || model.capabilities.includes('embeddings')))
      )
        continue;
      const known = catalog.get(model.id);
      const [repo, file] = (model.checkpoint ?? '').split(':');
      if (known && (!repo || repo === known.repo) && (!file || known.files.includes(file)))
        add(known);
      else {
        add({
          name: model.name,
          repo: repo?.includes('/') ? repo : null,
          revision: known && repo === known.repo ? known.revision : null,
          files: file
            ? [file, ...(known?.files.filter((path) => path.startsWith('mmproj-')) ?? [])]
            : [],
          bytes: 0,
        });
      }
    }
    if (server.kind === 'fastflowlm') {
      for (const id of [...NPU_CHAT_MODELS, NPU_EMBED])
        if (!server.models.some((model) => model.id === id)) addNamed(id);
    }
  }
  if (servers.some((server) => ['halogen', 'lemonade'].includes(server.kind))) {
    for (const profile of LOCAL_PROFILES)
      if (
        catalog.has(profile.model) &&
        !servers.some((server) => server.models.some((model) => model.id === profile.model)) &&
        !watches.has(catalog.get(profile.model)!.repo!)
      )
        addNamed(profile.model);
  }
  const services = inventory as {
    voice?: {
      whisper?: { present?: boolean; modelFiles?: string[] };
      qwentts?: { present?: boolean; modelFiles?: string[] };
    };
    embedding?: { present?: boolean; modelFiles?: string[] };
  } | null;
  for (const [name, service] of [
    ['Whisper', services?.voice?.whisper],
    ['TTS', services?.voice?.qwentts],
    ['Embedding', services?.embedding],
  ] as const) {
    if (!service?.present) continue;
    if (!service.modelFiles?.length) {
      if (
        ![...watches.values()].some((entry) =>
          entry.name.toLowerCase().includes(name.toLowerCase()),
        )
      )
        addNamed(name);
      continue;
    }
    for (const file of service.modelFiles) {
      const entry = [...catalog.values()].find((model) =>
        (model.localFiles ?? model.files).some((path) => path.split('/').pop() === file),
      );
      if (entry && !watches.get(entry.repo!)?.files.includes(entry.files[0]!)) add(entry);
      else if (!entry) addNamed(`${name}: ${file}`);
    }
  }
  const halogenSources = [...watches.values()].filter((entry) =>
    halogen.some((row) => row[1] === entry.repo),
  );
  for (const entry of halogenSources)
    entry.companionBytes = halogenSources
      .filter((other) => other !== entry)
      .reduce((sum, other) => sum + other.bytes, 0);
  return [...watches.values()];
}
