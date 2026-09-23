'use client';

import { useCallback, useEffect, useState } from 'react';
import { looksLikeRoles } from '../utils/rolesTransfer';
import { readClipboardText } from '@/utils/clipboard';

// Reading the clipboard outside a user gesture works only where clipboard-read has
// been granted (Chromium). Everywhere else the content stays unknown, and the paste
// action is offered anyway rather than hidden.
async function clipboardHasRoles(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: 'clipboard-read' as PermissionName,
    });
    if (status.state !== 'granted') return true;
    return looksLikeRoles(await readClipboardText());
  } catch {
    return true;
  }
}

// Whether to offer pasting roles: true while the clipboard holds a roles payload or
// cannot be inspected. Re-checked whenever the tab regains focus, and through the
// returned callback after this page writes to the clipboard itself.
export function useClipboardHasRoles(): { hasRoles: boolean; recheck: () => void } {
  const [hasRoles, setHasRoles] = useState(false);

  const recheck = useCallback(() => {
    void clipboardHasRoles().then(setHasRoles);
  }, []);

  useEffect(() => {
    recheck();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  return { hasRoles, recheck };
}
