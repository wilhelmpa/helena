function hintTone(name: string): 'negative' | 'positive' | 'neutral' {
  if (/kein veto|positiv|\bsignal\b|bestätigt|freigabe/i.test(name)) return 'positive';
  if (/veto|negativ|risiko|warn/i.test(name)) return 'negative';
  return 'neutral';
}

export function BoardHintPill({ name }: { name: string }) {
  return <span className={`board-hint board-hint-${hintTone(name)}`}>{name}</span>;
}
