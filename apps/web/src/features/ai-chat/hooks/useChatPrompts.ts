'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createChatPrompt,
  deleteChatPrompt,
  listChatPrompts,
  updateChatPrompt,
  type ChatPromptInput,
} from '@/lib/api/endpoints/chatPrompts';
import { qk } from '@/services/queryKeys';

// The member's saved prompt library, offered in the `/` menu next to the Hermes slash
// commands. `projectKey` null reads every prompt available in this chat: the member's
// own (no project) plus the ones saved for this project.
export function useChatPrompts(projectKey: string | null) {
  return useQuery({
    queryKey: qk.chatPrompts(projectKey),
    queryFn: () => listChatPrompts(projectKey),
  });
}

export function useChatPromptMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['chatWorkspace', 'prompts'] });

  const create = useMutation({
    mutationFn: (input: ChatPromptInput) => createChatPrompt(input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number;
      patch: Partial<Omit<ChatPromptInput, 'projectKey'>>;
    }) => updateChatPrompt(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteChatPrompt(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}
