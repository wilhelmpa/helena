import { redirect } from 'next/navigation';
import { credentialsPath } from '@/utils/paths';

export default function Page() {
  redirect(credentialsPath());
}
