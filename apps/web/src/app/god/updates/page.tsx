import { redirect } from 'next/navigation';
import { serverPath } from '@/utils/paths';

// The update center is the Updates tab of Administrator → Server.
export default function Page() {
  redirect(serverPath('updates'));
}
