// node --test server/__tests__
// Contact dedup: emails are normalized before search/create, and a create that
// collides (409) resolves to the existing contact instead of a null id.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN || 'test-token';
const hubspot = require('../services/hubspot');

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Stub fetch with a responder; returns the recorded calls.
function stubFetch(t, respond) {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const call = { url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(call);
    return respond(call);
  };
  t.after(() => { global.fetch = realFetch; });
  return calls;
}

const CONFLICT = { status: 'error', message: 'Contact already exists. Existing ID: 98765', category: 'CONFLICT' };

test('normalizeEmail trims and lowercases', () => {
  assert.equal(hubspot.normalizeEmail('  Jane.Doe@Acme.COM '), 'jane.doe@acme.com');
  assert.equal(hubspot.normalizeEmail(undefined), '');
});

test('existingIdFromConflict reads the id from a 409 only', () => {
  assert.equal(hubspot.existingIdFromConflict({ status: 409, data: CONFLICT }), '98765');
  assert.equal(hubspot.existingIdFromConflict({ status: 400, data: CONFLICT }), null);
  assert.equal(hubspot.existingIdFromConflict({ status: 409, data: { message: 'other' } }), null);
  assert.equal(hubspot.existingIdFromConflict(null), null);
});

test('searchContactByEmail and createContact send the normalized email', async (t) => {
  const calls = stubFetch(t, (c) => (c.url.endsWith('/search') ? json(200, { total: 0, results: [] }) : json(201, { id: '1' })));
  await hubspot.searchContactByEmail(' Jane@Acme.com ');
  await hubspot.createContact({ email: ' Jane@Acme.com ', firstname: 'Jane' });
  assert.equal(calls[0].body.filterGroups[0].filters[0].value, 'jane@acme.com');
  assert.deepEqual(calls[1].body.properties, { email: 'jane@acme.com', firstname: 'Jane' });
});

test('createContact 409 surfaces an error the caller can read the existing id from', async (t) => {
  stubFetch(t, () => json(409, CONFLICT));
  await assert.rejects(hubspot.createContact({ email: 'jane@acme.com' }), (err) => {
    assert.equal(hubspot.existingIdFromConflict(err), '98765');
    return true;
  });
});

test('recordSharedReportView updates the existing contact when the create collides', async (t) => {
  const calls = stubFetch(t, (c) => {
    if (c.url.endsWith('/search')) return json(200, { total: 0, results: [] });
    if (c.method === 'POST') return json(409, CONFLICT);
    return json(200, { id: '98765' });
  });
  await hubspot.recordSharedReportView({ email: ' Jane@Acme.com', reportUrl: 'https://x/?report=1' });
  assert.equal(calls[0].body.filterGroups[0].filters[0].value, 'jane@acme.com');
  assert.equal(calls[1].body.properties.email, 'jane@acme.com');
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'expected a PATCH to the existing contact');
  assert.ok(patch.url.endsWith('/crm/v3/objects/contacts/98765'));
  // An existing contact keeps its own lead source.
  assert.deepEqual(patch.body.properties, { gtmos_referred_report_url: 'https://x/?report=1' });
});

test('recordSharedReportView still throws a non-conflict create error', async (t) => {
  stubFetch(t, (c) => (c.url.endsWith('/search') ? json(200, { total: 0, results: [] }) : json(500, { message: 'boom' })));
  await assert.rejects(hubspot.recordSharedReportView({ email: 'a@b.co', reportUrl: '' }), /HubSpot API error: 500/);
});
