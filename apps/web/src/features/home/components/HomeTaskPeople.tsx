import { Bot } from 'lucide-react';
import type { CrossProjectIssue } from '@/lib/api/endpoints/issues';
import Avatar from '@/components/common/Avatar';
import { Text } from '@/design-system';

export default function HomeTaskPeople({ issue }: { issue: CrossProjectIssue }) {
  return (
    <span className="flex w-40 shrink-0 items-center justify-end gap-1.5 max-sm:w-auto">
      {issue.delegate && (
        <Text
          as="span"
          size="xs"
          tone="muted"
          className="flex max-w-28 items-center gap-1 rounded-sm border px-1"
          title={issue.delegate.name}
        >
          <Bot className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate" dir="auto">
            {issue.delegate.name}
          </span>
        </Text>
      )}
      {issue.assignee && (
        <Avatar
          name={issue.assignee.name}
          image={issue.assignee.image}
          title={issue.assignee.name}
        />
      )}
    </span>
  );
}
