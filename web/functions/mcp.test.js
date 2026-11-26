import { describe, expect, it } from 'vitest';
import { onRequest } from './mcp.js';

const MOCK_CITY = {
  city: { id: 'jaipur', name: 'Jaipur' },
  societies: [
    {
      id: 's5098933', name: 'Purple Melodia', developer: 'Purple Group', locality: 'Vaishali Nagar',
      lat: 26.9064, lng: 75.736, kind: 'apartment', status: 'Ready To Move', possession: '2021',
      rera_id: 'RAJ/P/2018/700', towers: 4, units: 226, acres: 1.78, verified: true, ai_read: false,
      score: 8.2, rating: 4.5, rating_count: 10, sale_count: 9, rent_count: 16,
      amenities: ['Swimming Pool', 'Gymnasium'], amen_facts: {},
      nearby: { park: { m: 300, name: 'Central Park' } },
      unit_types: [{ label: '3 BHK 1850', bhk: 3, super_sqft: 1850, bedrooms: [[11.5, 13], [12, 14], [12, 15]], rooms_complete: true, source: 'https://example.com/b.pdf', page: '5' }],
      prices: { 3: { buy: { median: 18000000, min: 17000000, max: 19000000, n: 5 }, rent: { median: 45000, min: 40000, max: 50000, n: 4 }, psf: 9700 } },
      url: 'https://www.magicbricks.com/purple-melodia', gmaps: 'https://maps.google.com', brochure_url: null,
    },
  ],
};

function makeEnv() {
  return {
    ASSETS: {
      fetch: async (req) => {
        const u = new URL(req.url);
        if (u.pathname === '/data/jaipur.json') return new Response(JSON.stringify(MOCK_CITY), { status: 200 });
        if (u.pathname === '/data/jaipur-details.json') return new Response(JSON.stringify({ s5098933: { ratings: { maintenance: 4.5 }, reviews: [], description: 'Test' } }), { status: 200 });
        return new Response('not found', { status: 404 });
      },
    },
  };
}

async function rpc(method, params) {
  const res = await onRequest({
    request: new Request('https://flat-finder.pages.dev/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    env: makeEnv(),
  });
  return res.json();
}

describe('mcp server', () => {
  it('returns city-qualified society links in search_societies and get_society', async () => {
    const s = await rpc('tools/call', { name: 'search_societies', arguments: { city: 'jaipur', localities: ['Vaishali Nagar'] } });
    const parsed = JSON.parse(s.result.content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.results[0].link).toBe('https://flat-finder.pages.dev/?city=jaipur&open=s5098933');

    const d = await rpc('tools/call', { name: 'get_society', arguments: { city: 'jaipur', name: 'Melodia' } });
    const detail = JSON.parse(d.result.content[0].text);
    expect(detail.flat_finder).toBe('https://flat-finder.pages.dev/?city=jaipur&open=s5098933');
  });
});
