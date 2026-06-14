const ANYSITE_BASE = process.env.ANYSITE_BASE_URL || 'https://api.anysite.io';
const cache = require('../utils/cache');

function anysiteHeaders() {
  return {
    'access-token': process.env.ANYSITE_API_KEY,
    'Content-Type': 'application/json'
  };
}

async function anysiteFetch(path, options = {}) {
  const controller = new AbortController();
  const reqTimeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${ANYSITE_BASE}${path}`, {
      ...options,
      headers: { ...anysiteHeaders(), ...options.headers },
      signal: controller.signal
    });
    if (!res.ok) {
      let body;
      try { body = await res.text(); } catch {}
      const err = new Error(`Anysite API error: ${res.status}${body ? ' - ' + body : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(reqTimeout);
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

// Extract the LinkedIn username/slug from a profile URL.
// https://www.linkedin.com/in/jane-doe-123 -> "jane-doe-123"
function linkedinUsernameFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// Fetch a person's recent LinkedIn posts. Best-effort: returns [] on any failure
// so the analysis proceeds without it. `identifier` is the LinkedIn username/slug
// (or a full profile URL, from which we extract the slug).
async function getLinkedInPosts(identifier, count = 20) {
  const user = linkedinUsernameFromUrl(identifier) || identifier;
  if (!user) return [];

  const cacheKey = `liposts:${user}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/linkedin/user/posts', {
      method: 'POST',
      body: JSON.stringify({ user, count })
    });

    const raw = Array.isArray(data) ? data
      : (data.posts || data.results || data.data || []);

    const posts = (Array.isArray(raw) ? raw : []).map((p) => ({
      text: p.text || p.commentary || p.content || p.title || '',
      date: p.posted_at || p.date || p.published || p.created_at || '',
      url: p.url || p.post_url || p.share_url || ''
    })).filter(p => p.text);

    cache.set(cacheKey, posts);
    return posts;
  } catch (err) {
    console.warn('Anysite posts lookup failed:', err.message);
    cache.set(cacheKey, []);
    return [];
  }
}

// Search a company's open LinkedIn job postings. Best-effort: returns [] on
// failure. `company` is a company name (we fall back to the domain root).
async function getCompanyJobs(company, count = 15) {
  if (!company) return [];

  const cacheKey = `jobs:${String(company).toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/linkedin/search/jobs', {
      method: 'POST',
      body: JSON.stringify({ company, count })
    });

    const raw = Array.isArray(data) ? data
      : (data.jobs || data.results || data.data || []);

    const jobs = (Array.isArray(raw) ? raw : []).map((j) => ({
      title: j.title || j.job_title || j.name || '',
      location: j.location || j.job_location || '',
      url: j.url || j.job_url || '',
      postedAt: j.posted_at || j.listed_at || j.date || ''
    })).filter(j => j.title);

    cache.set(cacheKey, jobs);
    return jobs;
  } catch (err) {
    console.warn('Anysite jobs lookup failed:', err.message);
    cache.set(cacheKey, []);
    return [];
  }
}

// Fetch a company's LinkedIn profile. Used for the logo on the results page and
// a few facts (industry, size, description) that enrich the analysis. Best-effort.
async function getCompanyProfile(identifier) {
  if (!identifier) return null;

  const cacheKey = `company:${String(identifier).toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/linkedin/company', {
      method: 'POST',
      body: JSON.stringify({ user: identifier })
    });

    const c = (data && (data.company || data.data || data.results)) || data || {};
    const co = Array.isArray(c) ? (c[0] || {}) : c;

    const profile = {
      name: co.name || co.company_name || '',
      logoUrl: co.logo_url || co.logo || co.image || co.profile_picture || co.logoUrl || '',
      industry: co.industry || '',
      employeeCount: co.employee_count || co.staff_count || co.company_size || co.employees || '',
      description: String(co.description || co.tagline || co.about || '').slice(0, 800),
      headquarters: co.headquarters || co.location || ''
    };

    cache.set(cacheKey, profile);
    return profile;
  } catch (err) {
    console.warn('Anysite company lookup failed:', err.message);
    return null; // not cached, so it can retry on the next request
  }
}

async function checkBuiltWith(domain) {
  const cached = cache.get(`builtwith:${domain}`);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/ai_based/builtwith/technologies', {
      method: 'POST',
      body: JSON.stringify({ domain, timeout: 300 })
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

module.exports = { enrichPersonByEmail, checkBuiltWith, getLinkedInPosts, getCompanyJobs, getCompanyProfile, linkedinUsernameFromUrl };
