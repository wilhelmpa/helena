'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getVoiceSettings,
  updateVoiceSettings,
  type VoiceSettings,
  type VoiceSettingsPatch,
} from '@/lib/api/endpoints/voice';

// The owner's voice settings, under Lokale KI's key: a change refreshes what the chat's voice
// reads from `GET /voice` (the pause) as well.
export const voiceSettingsKey = ['localAi', 'voice', 'settings'] as const;

export function useVoiceSettings() {
  return useQuery({
    queryKey: voiceSettingsKey,
    queryFn: getVoiceSettings,
    staleTime: 30_000,
    retry: false,
  });
}

export function useUpdateVoiceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: VoiceSettingsPatch) => updateVoiceSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData<VoiceSettings>(voiceSettingsKey, settings);
      void qc.invalidateQueries({ queryKey: ['localAi', 'voice'] });
    },
  });
}
