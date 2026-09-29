// Numbers, money and times of the trading dashboard, in the reader's language. Nothing
// here is trading logic: the API sends plain numbers and ISO times.

export function formatMoney(
  value: number,
  currency: string,
  locale: string,
  options: { sign?: boolean; digits?: number } = {},
): string {
  const digits = options.digits ?? 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: options.sign ? 'exceptZero' : 'auto',
    }).format(value);
  } catch {
    // A currency code the runtime does not know: the number, then the code.
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} ${currency}`;
  }
}

export function formatPercent(value: number, locale: string, options: { sign?: boolean } = {}) {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: options.sign ? 'exceptZero' : 'auto',
  }).format(value)} %`;
}

// Whole shares as a plain number, fractional ones (crypto, fractional shares) up to six digits.
export function formatQuantity(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
}

export function formatCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

// A time of a trading day. `short`: today's clock time; `date`: the day; `both`: day and time.
export function formatTradingTime(
  iso: string | null,
  locale: string,
  style: 'short' | 'date' | 'both' = 'both',
): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { hour: '2-digit', minute: '2-digit' }
      : style === 'date'
        ? { day: '2-digit', month: '2-digit' }
        : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

// Positive numbers are good news, negative ones bad; zero and unknown stay quiet.
export function pnlTone(value: number | null | undefined): 'success' | 'danger' | 'default' {
  if (value == null || value === 0) return 'default';
  return value > 0 ? 'success' : 'danger';
}

// How much of a limit is used (0–1+), and the two thresholds the bar turns colour at.
export function usage(used: number, limit: number) {
  const ratio = limit > 0 ? Math.max(0, used) / limit : 0;
  return { ratio: Math.min(ratio, 1), raw: ratio, warned: ratio >= 0.8, reached: ratio >= 1 };
}
