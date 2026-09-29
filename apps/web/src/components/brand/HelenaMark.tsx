import { ORB, orbGeometry, type OrbDetail } from '@helena/brand';

// The mark uses the same 100×100 geometry as the generated icons. At 24px, the
// optical variant widens the ring, core and satellite. The tile follows data-theme.
export default function HelenaMark({
  className,
  detail,
}: {
  className?: string;
  detail?: 'small' | 'large';
}) {
  const optical: OrbDetail =
    detail === 'small' || (!detail && className?.includes('size-6')) ? 'small' : 'regular';
  const { stroke, core, satellite } = orbGeometry(optical);
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <style>{`[data-theme='dark'] .volition-orb-tile { fill: ${ORB.tileDark}; }`}</style>
      <rect className="volition-orb-tile" width="100" height="100" rx="23" fill={ORB.tileLight} />
      <circle cx="50" cy="52" r="23" stroke={ORB.ring} strokeWidth={stroke} />
      <circle cx="50" cy="52" r={core} fill={ORB.core} />
      <circle cx="72" cy="30" r={satellite} fill={ORB.paper} />
    </svg>
  );
}
