import { redirect } from 'next/navigation';

// "System" is no page of its own any more (owner, O8): its figures and failures are on the
// dashboard — the System tile and, opened from it, the full health overview.
export default function Page(): never {
  redirect('/dashboard?system=1');
}
