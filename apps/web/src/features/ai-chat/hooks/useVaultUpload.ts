'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { uploadFiles } from '@/lib/api/endpoints/projectFiles';
import { chatUploadScope, chatVaultPath } from '../utils/chatVaultPaths';

export { chatUploadScope } from '../utils/chatVaultPaths';

// Where a chat's dropped, pasted or uploaded files land in the vault: the one chat
// folder among the project's files (Projects/<KEY>/Files/Chat), or Home/Files/Chat for a
// Home chat. The API stores an agent's chat attachments there too (chat-attachments
// CHAT_FILES_FOLDER). The composer attaches the resulting vault paths the same way a
// member who typed them would.
export const CHAT_UPLOAD_FOLDER = 'Files/Chat';

// Uploads the files a member dropped, pasted or picked into the chat's vault folder
// and returns their vault paths, ready to send as attachments. A failed upload is
// toasted once for the whole batch rather than per file.
export function useVaultUpload(scopeKey: string) {
  const t = useTranslations('chatWorkspace');
  return useMutation({
    mutationFn: async (files: File[]) => {
      const items = await uploadFiles(chatUploadScope(scopeKey), CHAT_UPLOAD_FOLDER, files);
      return items.map((item) => chatVaultPath(scopeKey, item.path));
    },
    onError: () => toast.error(t('composer.uploadFailed')),
  });
}
