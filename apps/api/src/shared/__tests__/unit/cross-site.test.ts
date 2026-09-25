import { describe, expect, it } from 'bun:test';
import { crossSiteRefusal } from '../../cross-site';

const OWN = ['https://helena.example.com', 'https://helena-home.example.com'];

function request(method: string, headers: Record<string, string>) {
  return new Request('http://localhost/projects', { method, headers });
}

describe('crossSiteRefusal (Fetch Metadata)', () => {
  it('refuses a change a page of another origin makes with the owner’s cookie', () => {
    for (const site of ['same-site', 'cross-site', 'Same-Site']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const refusal = crossSiteRefusal(
          request(method, { cookie: 's=1', 'sec-fetch-site': site }),
        );
        expect(refusal?.status).toBe(403);
      }
    }
  });

  it('lets Helena’s own pages, reads, servers and API keys through', () => {
    const cases: [string, Record<string, string>][] = [
      ['POST', { cookie: 's=1', 'sec-fetch-site': 'same-origin' }],
      ['POST', { cookie: 's=1', 'sec-fetch-site': 'none' }],
      ['POST', { cookie: 's=1' }],
      ['GET', { cookie: 's=1', 'sec-fetch-site': 'cross-site' }],
      ['HEAD', { cookie: 's=1', 'sec-fetch-site': 'same-site' }],
      ['OPTIONS', { cookie: 's=1', 'sec-fetch-site': 'cross-site' }],
      ['POST', { 'x-api-key': 'k', 'sec-fetch-site': 'cross-site' }],
      ['POST', {}],
      // The web app on another origin of Helena's own (APP_URL), e.g. web and API on two ports.
      ['POST', { cookie: 's=1', 'sec-fetch-site': 'same-site', origin: OWN[1]! }],
    ];
    for (const [method, headers] of cases) {
      expect(crossSiteRefusal(request(method, headers), OWN)).toBeNull();
    }
  });

  it('says why', async () => {
    const refusal = crossSiteRefusal(
      request('POST', { cookie: 's=1', 'sec-fetch-site': 'same-site' }),
      OWN,
    )!;
    expect(((await refusal.json()) as { code: string }).code).toBe('cross_site_refused');
    expect(refusal.headers.get('cache-control')).toBe('no-store');
  });
});
