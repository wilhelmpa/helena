import { describe, expect, it } from 'bun:test';
import { HttpError } from '../../lib';
import { crossSiteRefusal } from '../../cross-site';

const OWN = ['https://helena.example.com', 'https://helena-home.example.com'];

function request(method: string, headers: Record<string, string>) {
  return new Request('http://localhost/projects', { method, headers });
}

describe('crossSiteRefusal (Fetch Metadata)', () => {
  it('refuses a change a page of another origin makes with the owner’s cookie', () => {
    for (const site of ['same-site', 'cross-site', 'Same-Site']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(() =>
          crossSiteRefusal(request(method, { cookie: 's=1', 'sec-fetch-site': site })),
        ).toThrow(HttpError);
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

  it('uses the shared error model and preserves its code', () => {
    try {
      crossSiteRefusal(request('POST', { cookie: 's=1', 'sec-fetch-site': 'same-site' }), OWN);
      throw new Error('Expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 403, code: 'cross_site_refused' });
    }
  });
});
