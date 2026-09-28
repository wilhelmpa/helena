import {
  isNewerVersion,
  type UpdateCandidate,
  type UpdateCheckContext,
  type UpdateApplyRequest,
} from '@helena/sdk';
import { sendHelperRequest } from '../updates/helper';
import { githubNewest } from '../updates/sources/vendors';

const REPOSITORY = 'ggml-org/whisper.cpp';

// The privileged helper binds readiness to the verified package and a short Root window.
export async function whisperUpdateCandidate(
  context: UpdateCheckContext,
): Promise<UpdateCandidate | null> {
  const inventory = await context.inventory();
  const voice = inventory?.voice as { whisper?: Record<string, unknown> } | undefined;
  const whisper = voice?.whisper;
  if (!whisper || whisper.present === false) return null;
  const installed =
    whisper.versionSource === 'running-executable-path' &&
    whisper.state === 'active' &&
    typeof whisper.version === 'string' &&
    /^\d+\.\d+\.\d+$/.test(whisper.version)
      ? whisper.version
      : null;
  let available: string | null = null;
  let error = installed
    ? null
    : 'The installed Whisper.cpp version could not be verified from the active STT service';
  try {
    available = await githubNewest(context, REPOSITORY);
    if (!available) error ??= 'No stable Whisper.cpp release could be verified';
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const readiness = whisper.update as Record<string, unknown> | undefined;
  const ready =
    readiness?.ready === true &&
    readiness.version === available &&
    available === '1.9.4' &&
    installed === '1.8.4' &&
    typeof readiness.expiresAt === 'number' &&
    readiness.expiresAt * 1000 > context.now.getTime();
  const hint =
    readiness?.code === 'recovery-required'
      ? 'localAi.updates.whisperRecoveryRequired'
      : readiness?.code === 'maintenance-required' || readiness?.code === 'ready'
        ? 'localAi.updates.whisperMaintenanceRequired'
        : 'localAi.updates.whisperBuildRequired';
  return {
    component: 'whisper-cpp',
    name: 'Whisper.cpp (STT)',
    installed,
    available,
    updateAvailable: isNewerVersion(available, installed),
    security: false,
    sourceUrl: `https://github.com/${REPOSITORY}`,
    notesUrl: available ? `https://github.com/${REPOSITORY}/releases/tag/v${available}` : null,
    applicable: ready,
    hint: ready ? null : { i18n: hint },
    error,
    data: {
      versionSource: installed ? 'running-executable-path' : null,
      state: whisper.state,
      readiness: readiness?.code ?? 'preparation-required',
      expiresAt: readiness?.expiresAt ?? null,
    },
  };
}

export async function applyWhisperUpdate(request: UpdateApplyRequest) {
  if (
    request.component !== 'whisper-cpp' ||
    request.target !== '1.9.4' ||
    request.candidate.component !== 'whisper-cpp' ||
    request.candidate.available !== request.target ||
    !request.candidate.applicable ||
    (request.components?.length ?? 1) !== 1 ||
    request.components?.some((entry) => entry.component !== 'whisper-cpp')
  )
    throw new Error('Only the verified Whisper package can be activated from Helena');
  return { ref: await sendHelperRequest('whisper-ui', { version: request.target }) };
}
