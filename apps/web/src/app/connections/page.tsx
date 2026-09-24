import { redirect } from 'next/navigation';
import { accessPath } from '@/utils/paths';

// The page is a tab of the access center now.
export default function Page() {
  redirect(accessPath('connections'));
}
