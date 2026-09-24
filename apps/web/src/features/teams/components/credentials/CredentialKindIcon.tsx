import { Cpu, Globe, KeyRound, Lock, Plug, TerminalSquare } from 'lucide-react';
import type { ListedKind } from '@/lib/api/endpoints/credentials';

export const CREDENTIAL_KIND_ICONS = {
  web_login: Globe,
  api_key: KeyRound,
  ssh_key: TerminalSquare,
  secret: Lock,
  runtime_login: Cpu,
  mcp_oauth: Plug,
} satisfies Record<ListedKind, typeof Globe>;

export function CredentialKindIcon({ kind, className }: { kind: ListedKind; className?: string }) {
  const Icon = CREDENTIAL_KIND_ICONS[kind];
  return <Icon className={className} />;
}
