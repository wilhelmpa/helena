// Checks for the URLs people type into a form, run before anything is sent: the API
// accepts only absolute http(s) URLs and answers anything else with a 400.

// A bare domain typed without a scheme is treated as https.
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// A host name (an internationalised one arrives as punycode) or an IP address.
const HOST = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.?$|^\[[0-9a-f:.]+\]$/i;

// An absolute http(s) URL with a proper host. Chrome's parser accepts a space in the
// host ("https://kein url" becomes "kein%20url"), which the API's parser refuses, so the
// host is checked on its own.
export function isHttpUrl(value: string): boolean {
  if (/\s/.test(value.trim())) return false;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && HOST.test(url.hostname);
  } catch {
    return false;
  }
}
