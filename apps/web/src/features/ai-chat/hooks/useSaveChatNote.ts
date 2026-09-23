'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createTextFile } from '@/lib/api/endpoints/projectFiles';
import { chatUploadScope } from './useVaultUpload';
import { chatNoteMarkdown, chatNotePath } from '../utils/chatNote';
import type { PlanUIMessage } from '../utils/chatMessages';

export interface SaveChatNoteInput {
  scopeKey: string;
  title: string;
  agentName: (message: PlanUIMessage) => string;
  messages: PlanUIMessage[];
}

// Saves the conversation as a Markdown note in the vault (Docs/…), the way a member
// would write one up by hand: the questions and answers as they read, without the
// reasoning and the tool calls that were how the agent got there.
export function useSaveChatNote() {
  const t = useTranslations('chatWorkspace');

  return useMutation({
    mutationFn: async (input: SaveChatNoteInput) => {
      const now = new Date();
      const markdown = chatNoteMarkdown({
        title: input.title,
        agentName: input.agentName,
        messages: input.messages,
        date: now.toISOString(),
        labels: {
          question: t('messages.noteQuestion'),
          answer: (agent) => t('messages.noteAnswer', { agent }),
          source: (agent, date) => t('messages.noteSource', { agent, date }),
        },
      });
      const path = chatNotePath(input.title, now);
      await createTextFile(chatUploadScope(input.scopeKey), path, markdown);
      return path;
    },
    onError: () => toast.error(t('messages.noteSaveFailed')),
  });
}
