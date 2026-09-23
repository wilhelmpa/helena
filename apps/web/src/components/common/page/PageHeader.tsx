import type { ReactNode } from 'react';

// The title and description block at the top of a page body outside the app shell
// (FullPageView: the account pages). Inside the shell a page uses the title bar
// (WorkspacePageHeader) instead. Title 20 semibold, description 13 muted. `actions` renders on the right of the
// header row (e.g. a page-level primary button), and under it on a narrow screen.
export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>
      </div>
      {actions && (
        <div className="flex gap-2 sm:shrink-0 [&>button]:flex-1 sm:[&>button]:flex-none">
          {actions}
        </div>
      )}
    </header>
  );
}
