import { redirect } from 'next/navigation';

// Helena's settings open at "Vorgaben für Projekte".
export default function Page() {
  redirect('/settings/defaults');
}
