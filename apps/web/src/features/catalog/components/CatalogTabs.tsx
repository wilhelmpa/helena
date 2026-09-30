export const CATALOG_TABS = ['library', 'catalog', 'sources', 'proposals', 'updates'] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

export function catalogTabOf(value: string | null | undefined): CatalogTab {
  return CATALOG_TABS.includes(value as CatalogTab) ? (value as CatalogTab) : 'library';
}
