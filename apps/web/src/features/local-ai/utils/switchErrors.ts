// The server's reasons a profile switch cannot be had (apps/api local-ai/global-model.ts), as the
// text key of the owner's language; anything else gets the general one.
export function switchErrorKey(message: string | undefined) {
  if (/downloaded local chat model/i.test(message ?? '')) return 'errors.notDownloaded' as const;
  if (/requires Halogen/i.test(message ?? '')) return 'errors.noHalogen' as const;
  if (/belongs to another server|registration changed/i.test(message ?? ''))
    return 'errors.otherServer' as const;
  return 'errors.general' as const;
}
