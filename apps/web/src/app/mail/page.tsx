import { redirect } from 'next/navigation';
import { globalInboxPath } from '@/utils/paths';

export default function Mail() {
  redirect(globalInboxPath());
}
