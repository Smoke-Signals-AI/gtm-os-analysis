// node --test server/__tests__
// Anysite's google/company substring-matches company websites and sorts by
// headcount, so a domain lookup must check the website before using a match.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ANYSITE_API_KEY = process.env.ANYSITE_API_KEY || 'test-key';
const anysite = require('../services/anysite');

test('websiteMatchesDomain accepts the domain and its subdomains only', () => {
  assert.equal(anysite.websiteMatchesDomain('https://acme.com', 'acme.com'), true);
  assert.equal(anysite.websiteMatchesDomain('http://www.eu.acme.com', 'acme.com'), true);
  assert.equal(anysite.websiteMatchesDomain('https://acme.com.au', 'acme.com'), false);
  assert.equal(anysite.websiteMatchesDomain('https://notacme.com', 'acme.com'), false);
  assert.equal(anysite.normalizeDomain('https://www.Acme.com/about'), 'acme.com');
});

test('resolveCompanyByDomain skips a bigger company whose website only contains the domain', async () => {
  const realFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify([
        { title: 'Acme Australia', website: 'https://acme.com.au', url: 'https://linkedin.com/company/acme-au' },
        { title: 'Acme', website: 'https://acme.com', url: 'https://linkedin.com/company/acme', alias: 'acme' },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  try {
    const r = await anysite.resolveCompanyByDomain('acme.com');
    assert.equal(r && r.name, 'Acme');
  } finally {
    global.fetch = realFetch;
  }
});
