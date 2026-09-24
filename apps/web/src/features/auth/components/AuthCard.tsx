import { Suspense } from 'react';
import type { ReactNode } from 'react';
import AuthFrame from '@/components/common/page/AuthFrame';
import AuthLegalNotice from './AuthLegalNotice';

// The card shared by every logged-out screen (see AuthFrame). The forms read the URL
// (an invite parameter, a reset token, a "just confirmed" flag), so they render inside
// a Suspense boundary — useSearchParams needs one for these pages to prerender.
export default function AuthCard({ children }: { children: ReactNode }) {
  return (
    <AuthFrame footer={<AuthLegalNotice />}>
      <Suspense fallback={null}>{children}</Suspense>
    </AuthFrame>
  );
}
