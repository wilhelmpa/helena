// Small formatting helpers of the decisions pages.

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${(value * 100).toFixed(digits)} %`;
}

export function milliseconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export function euros(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

// The class's short key for its i18n entries (`helena.model-router` → `router`).
export function classKey(id: string): string {
  switch (id) {
    case 'helena.model-router':
      return 'router';
    case 'helena.mail':
      return 'mail';
    case 'helena.receipts':
      return 'receipts';
    case 'helena.general':
      return 'general';
    case 'helena.browser':
      return 'browser';
    default:
      return id;
  }
}
