export function localAiRegistrationSlug(
  kind: 'lemonade' | 'halogen',
  defaultServerKind: string | null,
): string {
  if (kind === 'halogen') return 'halogen';
  return defaultServerKind && defaultServerKind !== 'lemonade' ? 'volition-lemonade' : 'local';
}
