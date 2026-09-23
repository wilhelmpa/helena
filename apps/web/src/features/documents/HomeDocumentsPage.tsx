'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import Shell from '@/components/layout/Shell';
import DocumentLoadingState from './components/DocumentLoadingState';
import DocumentsWorkspace from './components/DocumentsWorkspace';

// The Docs of Home: the notes under Home/Docs in the vault, which only the instance
// owner reaches. The API enforces the same.
export default function HomeDocumentsPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('documents');
  const { data: session, isPending } = useSession();
  // The session can already be in the store on hydration while the server rendered
  // without it, so the role is only read after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isOwner = mounted && session?.user.role === 'god';

  return (
    <Shell globalHome globalTitle={tNav('docs')} autoOpenGlobalChat={false}>
      {isOwner ? (
        <DocumentsWorkspace root="Home/Docs" canEdit />
      ) : mounted && !isPending ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          {t('ownerOnly')}
        </div>
      ) : (
        <DocumentLoadingState />
      )}
    </Shell>
  );
}
