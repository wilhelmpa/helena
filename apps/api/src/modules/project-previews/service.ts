import { createHash } from 'node:crypto';
import { projectSlug } from '#shared/agent-socket';
import { HttpError } from '#shared/lib';
import { getProjectById } from '#modules/projects/service';
import { PreviewLauncherError, previewLauncher } from './launcher';
import type { Preview, PreviewStart } from './model';

export function redactPreviewText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- Strip terminal escape sequences from program output.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(
        /(authorization["']?\s*[:=]\s*["']?(?:bearer\s+|basic\s+)?|bearer\s+)[^\s"']+/gi,
        '$1[redacted]',
      )
      .replace(
        /((?:[a-z0-9_]*(?:token|secret|password|api[_-]?key)[a-z0-9_]*)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
        '$1[redacted]',
      )
      .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@')
      .slice(0, 2048)
  );
}
function cleanPreview(preview: Preview): Preview {
  return {
    ...preview,
    command: redactPreviewText(preview.command),
    ...(preview.error ? { error: redactPreviewText(preview.error) } : {}),
  };
}
function browserInstruction(projectKey: string, url: string): string {
  return `Open ${url} with browser_navigate in project ${projectKey}, then inspect browser_snapshot. A refusal for another localhost address does not describe this managed preview. Report only what these calls verify; this server-local URL is not a link for the owner's device.`;
}
async function request<T>(
  projectKey: string,
  op: string,
  args: object = {},
  timeout?: number,
): Promise<T> {
  try {
    return await previewLauncher<T>({ ...args, op, slug: projectSlug(projectKey) }, timeout);
  } catch (error) {
    if (!(error instanceof PreviewLauncherError))
      throw new HttpError(503, 'The preview service is unavailable');
    const status =
      ({ invalid: 400, 'not-found': 404, busy: 409, readiness: 502 } as Record<string, number>)[
        error.code
      ] ?? 503;
    throw new HttpError(status, redactPreviewText(error.message), error.code);
  }
}
export async function listProjectPreviews(projectKey: string, name?: string): Promise<Preview[]> {
  const result = await request<{ previews: Preview[] }>(
    projectKey,
    'preview-status',
    name ? { name } : {},
  );
  return result.previews.map(cleanPreview);
}
export async function startProjectPreview(projectKey: string, body: PreviewStart) {
  const result = await request<{ preview: Preview; lines?: string[] }>(
    projectKey,
    'preview-start',
    body,
    90_000,
  );
  return {
    preview: cleanPreview(result.preview),
    ...(result.preview.status === 'running'
      ? { browserInstruction: browserInstruction(projectKey, result.preview.url) }
      : {}),
    ...(result.lines ? { lines: result.lines.map(redactPreviewText) } : {}),
  };
}
export async function stopProjectPreview(projectKey: string, name = 'main') {
  const result = await request<{ preview: Preview }>(projectKey, 'preview-stop', { name });
  return { preview: cleanPreview(result.preview) };
}
export async function readProjectPreviewLogs(projectKey: string, name = 'main', tail = 100) {
  const result = await request<{ preview: Preview; lines: string[] }>(projectKey, 'preview-logs', {
    name,
    tail,
  });
  return {
    preview: cleanPreview(result.preview),
    lines: result.lines.slice(-200).map(redactPreviewText),
  };
}
export async function getProjectPreviewUrl(projectKey: string, name = 'main') {
  const preview = (await listProjectPreviews(projectKey, name)).find(
    (entry) => entry.name === name,
  );
  if (!preview) throw new HttpError(404, 'Preview not found');
  if (preview.status !== 'running') throw new HttpError(409, 'The preview is not ready');
  return {
    name: preview.name,
    url: preview.url,
    browserInstruction: browserInstruction(projectKey, preview.url),
  };
}
export async function getProjectPreviewOrigins(projectKey: string): Promise<string[]> {
  try {
    return (await listProjectPreviews(projectKey)).flatMap((preview) => {
      if (preview.status !== 'running' || preview.slug !== projectSlug(projectKey)) return [];
      const url = new URL(preview.url);
      return url.protocol === 'http:' &&
        url.hostname === '127.0.0.1' &&
        Number(url.port) === preview.port &&
        preview.port >= 1024 &&
        !url.username &&
        !url.password
        ? [url.origin]
        : [];
    });
  } catch {
    return [];
  }
}
const revisions = new Map<number, { until: number; value: Promise<string> }>();
export async function projectPreviewRevision(projectId: number): Promise<string> {
  const cached = revisions.get(projectId);
  if (cached && cached.until > Date.now()) return cached.value;
  const value = (async () => {
    const project = await getProjectById(projectId);
    if (!project) return '0';
    const previews = await listProjectPreviews(project.key);
    return createHash('sha256')
      .update(
        JSON.stringify(
          previews.map(({ name, status, url, startedAt, error }) => ({
            name,
            status,
            url,
            startedAt,
            error,
          })),
        ),
      )
      .digest('hex');
  })().catch(() => 'unavailable');
  if (revisions.size > 1000) revisions.clear();
  revisions.set(projectId, { until: Date.now() + 2000, value });
  return value;
}
