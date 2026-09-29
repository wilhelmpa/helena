export function isLocalModel(model: string | null | undefined, provider?: string | null): boolean {
  return (
    /^helena-[a-z0-9][a-z0-9-]*$/.test(provider ?? '') ||
    model === 'volition-local-default' ||
    /^helena-[a-z0-9][a-z0-9-]*\/.+/.test(model ?? '')
  );
}
