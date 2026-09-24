import { useTranslations } from 'next-intl';
import type { StorageSettings } from '@/lib/api/endpoints/settings';
import { attachmentError, attachmentLimitHint, type UploadLimitWords } from '@/utils/uploadLimits';

// The upload limits worded in the reader's language: the hint beside a file picker and
// the reason a file is refused before it is sent.
export function useUploadLimitText() {
  const t = useTranslations('common.uploadLimits');
  const words: UploadLimitWords = {
    maxSize: (mb) => t('maxSize', { mb }),
    accepted: (types) => t('accepted', { types }),
    typeName: (name) => t(`types.${name}`),
    tooLarge: (name, mb) => t('tooLarge', { name, mb }),
    notAccepted: (name) => t('notAccepted', { name }),
  };
  return {
    hint: (limits: StorageSettings | undefined) => attachmentLimitHint(limits, words),
    error: (file: File, limits: StorageSettings | undefined) =>
      attachmentError(file, limits, words),
  };
}
