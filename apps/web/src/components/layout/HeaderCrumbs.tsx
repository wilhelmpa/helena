import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';

export type HeaderCrumb = { label: string; href?: string };

// The title of the single-row header as a breadcrumb: where the page sits (muted,
// each a link back), then the page itself (foreground, medium). A page never repeats
// its own name as a second, larger title in the same row. The earlier crumbs give way
// first on a narrow screen: they truncate hard, the current page keeps its room.
export default function HeaderCrumbs({ items }: { items: HeaderCrumb[] }) {
  const last = items.length - 1;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {items.map((item, index) => (
        <Fragment key={`${index}:${item.label}`}>
          {index > 0 && (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground max-sm:hidden rtl:rotate-180" />
          )}
          {index === last ? (
            <span className="min-w-0 truncate font-medium">{item.label}</span>
          ) : item.href ? (
            <Link
              href={item.href}
              className="max-w-40 min-w-0 shrink truncate font-normal text-muted-foreground transition-colors hover:text-foreground max-sm:hidden"
            >
              {item.label}
            </Link>
          ) : (
            <span className="max-w-40 min-w-0 shrink truncate font-normal text-muted-foreground max-sm:hidden">
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
