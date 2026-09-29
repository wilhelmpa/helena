import { redirect } from 'next/navigation';

export default function Approvals() {
  redirect('/inbox?tab=updates');
}
