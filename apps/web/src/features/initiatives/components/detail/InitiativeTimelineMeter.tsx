import { Box } from '@/design-system'; // One labelled progress bar in the timeline card: time elapsed or work done.
// `pct` is a fraction in 0..1.
export default function InitiativeTimelineMeter({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <Box marginBottom={1} className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(pct * 100)}%</span>
      </Box>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
