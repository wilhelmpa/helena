import type { MemberRow } from '@/lib/api/endpoints/members';
import { Text } from '@/design-system';

// A member's project description (what they do), one line under their name, aligned with
// it; the full text on hover (owner, 28.09.: no paragraphs in the member list). Editing
// is a separate action (MemberDescriptionDialog).
export default function MemberDescription({ member }: { member: MemberRow }) {
  if (!member.description) return null;
  return (
    <Text
      as="span"
      size="xs"
      tone="muted"
      truncate
      className="ds-row-subline"
      title={member.description}
    >
      {member.description}
    </Text>
  );
}
