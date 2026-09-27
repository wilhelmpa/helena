export interface DecisionAttempt {
  credentialId: number;
  role: 'first-stage' | 'regular';
}

export function decisionAttempts(
  stageCredentialId: number | undefined,
  credentialId: number | null,
  fallbackCredentialId: number | null,
): DecisionAttempt[] {
  const regular = [credentialId, fallbackCredentialId].filter(
    (id, index, list): id is number => typeof id === 'number' && list.indexOf(id) === index,
  );
  // The same connection may have an independent class assignment after a revoked stage.
  return [
    ...(stageCredentialId === undefined
      ? []
      : [{ credentialId: stageCredentialId, role: 'first-stage' as const }]),
    ...regular.map((id) => ({ credentialId: id, role: 'regular' as const })),
  ];
}
