import { isNewerVersion, type UpdateCandidate, type UpdateCheckContext } from '@helena/sdk';
import { githubNewest } from '../updates/sources/vendors';

const REPOSITORY = 'ggml-org/whisper.cpp';

// Native voice is independent of the model-server registry. Until a pinned ROCm build
// and transcription proof exist, this source reports status and never advertises apply.
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
  return {
    component: 'whisper-cpp',
    name: 'Whisper.cpp (STT)',
    installed,
    available,
    updateAvailable: isNewerVersion(available, installed),
    security: false,
    sourceUrl: `https://github.com/${REPOSITORY}`,
    notesUrl: available ? `https://github.com/${REPOSITORY}/releases/tag/v${available}` : null,
    group: 'local-ai',
    applicable: false,
    hint: { i18n: 'localAi.updates.whisperBuildRequired' },
    error,
    data: { versionSource: installed ? 'running-executable-path' : null, state: whisper.state },
  };
}
