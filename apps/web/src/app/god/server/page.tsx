import { redirect } from 'next/navigation';
import { serverPath } from '@/utils/paths';

// /god/server opens its overview; a host without it lands on the first tab it has.
export default function Page() {
  redirect(serverPath('overview'));
}
