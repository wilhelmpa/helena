import type { UpdateCandidate, UpdateCheckContext } from '@helena/sdk';
import { MODEL_MEMORY } from './npu-profile';

export interface WatchedModel {
  name: string;
  repo: string | null;
  revision: string | null;
  files: string[];
  localFiles?: string[];
  bytes: number;
  companionBytes?: number;
}

export interface ModelNotice {
  repository: string | null;
  revision: string | null;
  sizeBytes: number | null;
  license: string | null;
  date: string | null;
  fits: boolean;
  reason: string | null;
  baseline: string | null;
}

interface HfModel {
  id?: string;
  sha?: string;
  lastModified?: string;
  cardData?: { license?: string };
  tags?: string[];
  siblings?: { rfilename: string; size?: number; lfs?: { size?: number } }[];
}

const repositoryId = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function familyOf(repoName: string): { head: string; version: string; tail: string } | null {
  const match = /^([A-Za-z][A-Za-z-]*?)-?(\d+(?:\.\d+)?)(-.+)?$/.exec(repoName);
  return match ? { head: match[1]!, version: match[2]!, tail: match[3] ?? '' } : null;
}

export function newerInFamily(repo: string, candidates: string[]): string | null {
  const [author, name] = repo.split('/');
  const family = familyOf(name ?? '');
  if (!author || !family) return null;
  const version = (value: string) => value.split('.').map(Number);
  const newer = (a: string, b: string) => {
    const left = version(a),
      right = version(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0);
    }
    return false;
  };
  let best: { id: string; version: string } | null = null;
  for (const id of candidates) {
    if (!repositoryId.test(id)) continue;
    const [publisher, model] = id.split('/');
    const other = familyOf(model ?? '');
    if (publisher !== author || !other || other.head !== family.head || other.tail !== family.tail)
      continue;
    if (newer(other.version, best?.version ?? family.version))
      best = { id, version: other.version };
  }
  return best?.id ?? null;
}

function notice(watch: WatchedModel, repo: string, info: HfModel): ModelNotice {
  const baselineFamily = familyOf(watch.repo!.split('/')[1]!);
  const nextFamily = familyOf(repo.split('/')[1]!);
  const selectedFiles = watch.files.map((file) =>
    baselineFamily && nextFamily
      ? file.replace(
          `${baselineFamily.head}${baselineFamily.version}`,
          `${nextFamily.head}${nextFamily.version}`,
        )
      : file,
  );
  let completeShardLayout = true;
  const files = [
    ...new Set(
      selectedFiles.flatMap((file) => {
        const split = /^(.*)-\d{5}-of-(\d{5})(\.gguf)$/.exec(file);
        if (!split) return [file];
        const count = Number(split[2]);
        if (count < 1 || count > 1000) {
          completeShardLayout = false;
          return [];
        }
        return Array.from(
          { length: count },
          (_, index) =>
            `${split[1]}-${String(index + 1).padStart(5, '0')}-of-${split[2]}${split[3]}`,
        );
      }),
    ),
  ];
  const sizes = files.map((file) => {
    const found = info.siblings?.find((entry) => entry.rfilename === file);
    return found?.lfs?.size ?? found?.size;
  });
  const sizeBytes =
    completeShardLayout &&
    sizes.length &&
    sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)
      ? sizes.reduce<number>((sum, size) => sum + size!, 0)
      : null;
  const rawLicense =
    info.cardData?.license ?? info.tags?.find((tag) => tag.startsWith('license:'))?.slice(8);
  const license = typeof rawLicense === 'string' && rawLicense.trim() ? rawLicense : null;
  const date =
    info.lastModified && Number.isFinite(Date.parse(info.lastModified))
      ? new Date(info.lastModified).toISOString()
      : null;
  const revision = /^[0-9a-f]{40}$/.test(info.sha ?? '') ? info.sha! : null;
  let reason: string | null = null;
  if (!sizeBytes || !license || !date || !revision || !watch.revision || info.id !== repo)
    reason = 'Model metadata or configured files are unknown';
  else if (
    sizeBytes + (watch.companionBytes ?? 0) >
    MODEL_MEMORY.capacityBytes - MODEL_MEMORY.reserveGiB * 1024 ** 3
  )
    reason = `Exceeds ${MODEL_MEMORY.capacityBytes / 1e9} GB with ${MODEL_MEMORY.reserveGiB} GiB reserved`;
  return {
    repository: repo,
    revision,
    sizeBytes,
    license,
    date,
    fits: reason === null,
    reason,
    baseline: watch.revision,
  };
}

export async function checkWatchedModels(
  watches: WatchedModel[],
  context: UpdateCheckContext,
): Promise<UpdateCandidate[]> {
  const candidates: UpdateCandidate[] = [];
  for (const watch of watches) {
    let metadata: ModelNotice = {
      repository: watch.repo,
      revision: null,
      sizeBytes: null,
      license: null,
      date: null,
      fits: false,
      reason: 'Configured model source is unknown',
      baseline: watch.revision,
    };
    let changed = false;
    let error: string | null = null;
    try {
      if (watch.repo && repositoryId.test(watch.repo)) {
        const info = await context.fetchJson<HfModel>(
          `https://huggingface.co/api/models/${watch.repo}?blobs=true`,
        );
        metadata = notice(watch, watch.repo, info);
        changed = Boolean(
          watch.revision && metadata.revision && watch.revision !== metadata.revision,
        );
        candidates.push(candidate(watch, metadata, changed, null));
        const family = familyOf(watch.repo.split('/')[1]!);
        if (!family) continue;
        try {
          const author = watch.repo.split('/')[0]!;
          const list = await context.fetchJson<HfModel[]>(
            `https://huggingface.co/api/models?author=${encodeURIComponent(author)}&search=${encodeURIComponent(family.tail.replace(/^-/, '') || family.head)}&sort=lastModified&direction=-1&limit=50`,
          );
          const newer = newerInFamily(
            watch.repo,
            Array.isArray(list) ? list.map((model) => model.id ?? '') : [],
          );
          if (newer) {
            const next = await context.fetchJson<HfModel>(
              `https://huggingface.co/api/models/${newer}?blobs=true`,
            );
            candidates.push(candidate(watch, notice(watch, newer, next), true, null));
          }
        } catch (failure) {
          context.log.warn(
            `Model family check for ${watch.repo} failed: ${String(failure).slice(0, 200)}`,
          );
        }
        continue;
      }
    } catch (failure) {
      error = String(failure).slice(0, 200);
      metadata = { ...metadata, fits: false, reason: 'Model metadata could not be checked' };
    }
    candidates.push(candidate(watch, metadata, changed, error));
  }
  return candidates;
}

function candidate(
  watch: WatchedModel,
  modelNotice: ModelNotice,
  changed: boolean,
  error: string | null,
): UpdateCandidate {
  const repo = modelNotice.repository;
  const revisionPath = modelNotice.revision ? `/tree/${modelNotice.revision}` : '';
  const identity =
    repo ?? `unknown:${encodeURIComponent(watch.name).replaceAll('%', '_').slice(0, 110)}`;
  return {
    component: `watch:${identity}`,
    name: watch.name,
    installed: null,
    available: modelNotice.revision,
    updateAvailable: changed,
    security: false,
    applicable: false,
    sourceUrl: repo ? `https://huggingface.co/${repo}${revisionPath}` : null,
    hint: changed
      ? {
          de: 'Neue Version verfügbar – vor dem Wechsel auswerten',
          en: 'New version available – evaluate before switching',
        }
      : {
          de: 'Modellquelle prüfen – vor dem Wechsel auswerten',
          en: 'Check model source – evaluate before switching',
        },
    detail: `${repo ?? 'unknown'}@${modelNotice.revision ?? 'unknown'} · ${modelNotice.sizeBytes ?? 'unknown'} bytes · ${modelNotice.license ?? 'unknown'} · ${modelNotice.date ?? 'unknown'}${modelNotice.fits ? '' : ' · passt nicht'}`,
    data: { modelNotice },
    error,
  };
}
