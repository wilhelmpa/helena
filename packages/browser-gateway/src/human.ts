// Human-like input timing (design §7): "Mausbewegung als Kurve zum Ziel, zufällige
// Tipp-Abstände (40–140 ms), kurze Pausen vor Klicks, Scrollen in Schritten." Pure
// helpers — no page/browser handle — so the curve math and delay ranges are unit-testable
// without patchright.

export function randomBetween(
  min: number,
  max: number,
  random: () => number = Math.random,
): number {
  return min + random() * (max - min);
}

export interface Point {
  x: number;
  y: number;
}

// A quadratic Bézier from `from` to `to` through a control point offset perpendicular to
// the straight line (so the path curves rather than being a dead-straight drag), sampled at
// `steps` points including the endpoint but not the start (the caller is already there).
export function mouseCurve(
  from: Point,
  to: Point,
  steps: number,
  random: () => number = Math.random,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  // A short hop barely curves; a long one gets a visible bow. Side is randomized so every
  // move does not bend the same way.
  const bow = Math.min(distance * 0.15, 60) * (random() < 0.5 ? -1 : 1);
  const nx = distance === 0 ? 0 : -dy / distance;
  const ny = distance === 0 ? 0 : dx / distance;
  const control: Point = { x: from.x + dx / 2 + nx * bow, y: from.y + dy / 2 + ny * bow };
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const jitterX = (random() - 0.5) * 1.5;
    const jitterY = (random() - 0.5) * 1.5;
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x;
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y;
    points.push({ x: x + (i === steps ? 0 : jitterX), y: y + (i === steps ? 0 : jitterY) });
  }
  return points;
}

export function stepsFor(from: Point, to: Point): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(4, Math.min(24, Math.round(distance / 20)));
}

export function typingDelayMs(random: () => number = Math.random): number {
  return Math.round(randomBetween(40, 140, random));
}

export function preClickPauseMs(random: () => number = Math.random): number {
  return Math.round(randomBetween(60, 180, random));
}

// Scroll in a handful of steps rather than one jump, each covering a fraction of the total
// with a short pause, matching how a wheel or trackpad actually delivers input.
export function scrollSteps(totalPx: number, steps = 4): number[] {
  const each = Math.round(totalPx / steps);
  const out = new Array(steps).fill(each);
  out[steps - 1] += totalPx - each * steps; // remainder goes on the last step
  return out;
}
