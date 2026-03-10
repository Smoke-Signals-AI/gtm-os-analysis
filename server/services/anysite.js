const ANYSITE_BASE = process.env.ANYSITE_BASE_URL || 'https://api.anysite.io';
const cache = require('../utils/cache');

function anysiteHeaders() {
  return {
    'Authorization': `Bearer ${process.env.ANYSITE_API_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function anysiteFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${ANYSITE_BASE}${path}`, {
      ...options,
      headers: { ...anysiteHeaders(), ...options.headers },
      signal: controller.signal
    });
    if (!res.ok) {
      const err = new Error(`Anysite API error: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichPersonByEmail(email) {
  try {
    const data = await anysiteFetch('/api/ai_based/linkedin/person/search', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    if (!data) return null;
    // Handle both flat response and results array
    const person = data.results ? data.results[0] : data;
    if (!person) return null;
    return {
      firstName: person.first_name || person.firstName || '',
      lastName: person.last_name || person.lastName || '',
      title: person.title || person.headline || '',
      company: person.company || person.company_name || '',
      linkedinUrl: person.linkedin_url || person.profile_url || '',
      location: person.location || '',
      headline: person.headline || ''
    };
  } catch (err) {
    console.warn('Anysite person enrichment failed:', err.message);
    return null;
  }
}

async function checkBuiltWith(domain) {
  const cached = cache.get(`builtwith:${domain}`);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/ai_based/builtwith/technologies', {
      method: 'POST',
      body: JSON.stringify({ domain })
    });

    const techNames = Array.isArray(data.technology_name)
      ? data.technology_name.map(t => String(t).toLowerCase())
      : [];

    const usesHubSpot = techNames.some(name => name.includes('hubspot'));

    const result = { usesHubSpot, technologies: techNames };
    cache.set(`builtwith:${domain}`, result);
    return result;
  } catch (err) {
    console.warn('BuiltWith lookup failed:', err.message);
    const fallback = { usesHubSpot: false, technologies: [] };
    cache.set(`builtwith:${domain}`, fallback);
    return fallback;
  }
}

module.exports = { enrichPersonByEmail, checkBuiltWith };
