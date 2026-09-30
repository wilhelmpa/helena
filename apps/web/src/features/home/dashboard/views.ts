// The two views of the Home dashboard (owner, O98): the overview, and every project as a
// tile ("Alle Projekte"). One page, one address; the view is the `view` parameter, and an
// unknown value is the overview.
export type HomeDashboardView = 'overview' | 'projects';

export const homeDashboardView = (value: string | null): HomeDashboardView =>
  value === 'projects' ? 'projects' : 'overview';

export const homeDashboardPath = (view: HomeDashboardView): string =>
  view === 'projects' ? '/dashboard?view=projects' : '/dashboard';
