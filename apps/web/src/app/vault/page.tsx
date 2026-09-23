import { notFound } from 'next/navigation';
import VaultPage from '@/features/vault/VaultPage';
import { serverRuntimeEnv } from '@/utils/runtimeEnv';

export default function Page() {
  if (!serverRuntimeEnv().workspace.vaultEnabled) notFound();
  return <VaultPage />;
}
