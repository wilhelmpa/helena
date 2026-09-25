// Money and dates of the receipts page in the reader's locale. Amounts arrive as integer
// cents and leave the amount field as integer cents; nothing here goes through a float sum.

export function formatCents(cents: number | null, currency: string, locale: string): string {
  if (cents === null) return '–';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function formatDay(iso: string | null, locale: string): string {
  if (!iso) return '–';
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

// 'YYYY-MM' as "September 2026".
export function formatMonth(month: string, locale: string): string {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return month;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, mon - 1, 1)),
  );
}

// The amount field: "172,50", "1.234,56", "-49,95", "12.50" (a single point with one or two
// digits after it is a decimal point). Returns integer cents, or null for anything else.
export function parseCentsInput(text: string): number | null {
  let value = text.replace(/[\s€]|EUR/gi, '');
  if (!value) return null;
  const negative = value.startsWith('-');
  if (negative) value = value.slice(1);
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(value) || /^\d+(,\d{1,2})?$/.test(value)) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const [whole = '0', fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

// Cents as the amount field shows them for editing: "172,50".
export function centsInput(cents: number | null): string {
  if (cents === null) return '';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

// The file's place in the project's Files page: its folder and the path below the project.
export function projectFileLocation(
  projectKey: string,
  vaultPath: string,
): { folder: string; file: string } | null {
  const prefix = `Projects/${projectKey.toUpperCase()}/`;
  if (!vaultPath.startsWith(prefix)) return null;
  const file = vaultPath.slice(prefix.length);
  const at = file.lastIndexOf('/');
  return { folder: at < 0 ? '' : file.slice(0, at), file };
}

// Saves a blob under a name through a temporary object URL.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
