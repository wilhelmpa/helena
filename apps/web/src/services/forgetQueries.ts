import type { QueryClient, QueryKey } from '@tanstack/react-query';

// The queries of something just deleted: dropped from the cache once no screen reads
// them any more. Removing them while the page that shows the thing is still open (the
// task panel, the initiative or cycle page) made that page fetch it again before it
// closed — a 404 for every deleted thing. Until then they keep their last data and are
// not fetched again.
export function forgetWhenUnused(qc: QueryClient, queryKey: QueryKey): void {
  void qc.cancelQueries({ queryKey });
  const cache = qc.getQueryCache();
  const observed = () => cache.findAll({ queryKey }).some((query) => query.getObserversCount() > 0);
  if (!observed()) {
    qc.removeQueries({ queryKey });
    return;
  }
  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== 'observerRemoved' || observed()) return;
    unsubscribe();
    qc.removeQueries({ queryKey });
  });
}
