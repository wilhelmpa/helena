import { redirect } from 'next/navigation';
import { accessPath } from '@/utils/paths';

export default function Page() {
  redirect(accessPath());
}
