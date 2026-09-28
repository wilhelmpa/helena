import { notFound } from 'next/navigation';
import StatusMatrixFixture from '@/components/helena/StatusMatrixFixture';

export default function StatusMatrixPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <StatusMatrixFixture />;
}
