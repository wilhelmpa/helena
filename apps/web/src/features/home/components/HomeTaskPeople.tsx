import { Bot } from 'lucide-react';
import type { CrossProjectIssue } from '@/lib/api/endpoints/issues';
import Avatar from '@/components/common/Avatar';
import { Pill } from '@/design-system';

export default function HomeTaskPeople({ issue }: { issue: CrossProjectIssue }) {
  return (
    <span className="flex w-40 shrink-0 items-center justify-end gap-1.5 max-sm:w-auto">
      {issue.delegate && (
        <Pill size="sm" className="max-w-28" icon={<Bot aria-hidden />} title={issue.delegate.name}>
          <span className="truncate" dir="auto">
            {issue.delegate.name}
          </span>
        </Pill>
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
