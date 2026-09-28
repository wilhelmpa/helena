import { headers } from 'next/headers';
import { sameSecret } from '@/lib/session-bootstrap';
import AuthCard from './components/AuthCard';
import AuthLoginForm from './components/login/AuthLoginForm';

export default async function AuthLoginPage() {
  const requestHeaders = await headers();
  const edgeSignInAvailable = Boolean(
    requestHeaders.get('cf-access-jwt-assertion') &&
    sameSecret(process.env.HELENA_EDGE_ENTRY_TOKEN, requestHeaders.get('x-helena-edge-entry')),
  );
  return (
    <AuthCard>
      <AuthLoginForm edgeSignInAvailable={edgeSignInAvailable} />
    </AuthCard>
  );
}
