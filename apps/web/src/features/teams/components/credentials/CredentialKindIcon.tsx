import { Globe, KeyRound, Lock, TerminalSquare } from 'lucide-react';
import type { CredentialKind } from '@/lib/api/endpoints/credentials';

export const CREDENTIAL_KIND_ICONS = {
  web_login: Globe,
  api_key: KeyRound,
  ssh_key: TerminalSquare,
  secret: Lock,
} satisfies Record<CredentialKind, typeof Globe>;

export function CredentialKindIcon({
  kind,
  className,
}: {
  kind: CredentialKind;
  className?: string;
}) {
  const Icon = CREDENTIAL_KIND_ICONS[kind];
  return <Icon className={className} />;
}
