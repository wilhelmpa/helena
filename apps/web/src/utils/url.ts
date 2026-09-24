// Checks for the URLs people type into a form, run before anything is sent: the API
// accepts only absolute http(s) URLs and answers anything else with a 400.

// A bare domain typed without a scheme is treated as https.
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// An absolute http(s) URL with a host.
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}
