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

// LinkedIn URN values come back as either a string ("fsd_profile:ACoAAA...") or
// an object. Normalize to the string form the API expects on input.
function urnString(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (v.urn) return urnString(v.urn);
    if (v.type && (v.id || v.value)) return v.type + ':' + (v.id || v.value);
    return v.value || v.id || v.fsd_profile || v.entity_urn || '';
  }
  return String(v);
}

function firstExperience(p) {
  const exp = p && (p.experience || p.experiences || p.positions);
  if (Array.isArray(exp) && exp.length) return exp[0];
  return null;
}

function summarizeShape(data) {
  try {
    if (Array.isArray(data)) {
      const f = data[0];
      return 'array(' + data.length + ')' + (f && typeof f === 'object' ? ' item keys: ' + Object.keys(f).slice(0, 15).join(',') : '');
    }
    if (data && typeof data === 'object') return 'keys: ' + Object.keys(data).slice(0, 20).join(',');
    return typeof data + ' ' + String(data).slice(0, 120);
  } catch (_) { return 'unknown'; }
}

async function emailLookup(path, email) {
  try {
    const data = await anysiteFetch(path, {
      method: 'POST',
      body: JSON.stringify({ email, timeout: 300 })
    });
    const p = Array.isArray(data) ? data[0] : (data && (data.data || data.user || data)) || null;
    if (p && (p.first_name || p.firstName || p.urn || p.name)) return p;
    console.log('[gtmos] ' + path + ': 200 but no profile fields. shape ->', summarizeShape(data));
    return null;
  } catch (err) {
    console.warn('[gtmos] ' + path + ' failed:', err.message);
    return null;
  }
}

// Find a person by first name + company when email lookup fails. Returns the
// top match's fsd_profile URN (for posts) and basic fields, or null.
async function searchPerson(firstName, company) {
  if (!firstName || !company) return null;
  try {
    const data = await anysiteFetch('/api/linkedin/search/users', {
      method: 'POST',
      body: JSON.stringify({ first_name: firstName, keywords: company, count: 3, timeout: 300 })
    });
    const arr = Array.isArray(data) ? data : (data.results || data.data || []);
    const top = (Array.isArray(arr) ? arr : [])[0] || null;
    if (!top) { console.log('[gtmos] searchPerson: no match for', { firstName, company }); return null; }
    const nameParts = String(top.name || '').trim().split(/\s+/);
    const result = {
      firstName: nameParts[0] || firstName,
      lastName: nameParts.slice(1).join(' '),
      profileUrn: urnString(top.urn || top.internal_id),
      headline: top.headline || '',
      linkedinUrl: top.url || '',
      alias: top.alias || ''
    };
    console.log('[gtmos] searchPerson:', { firstName, company, match: top.name, headline: String(top.headline || '').slice(0, 60), hasUrn: !!result.profileUrn });
    return result.profileUrn ? result : null;
  } catch (err) {
    console.warn('[gtmos] searchPerson failed:', err.message);
    return null;
  }
}

// Fetch the full, documented profile by alias/URL/URN. Reliable source of the
// fsd_profile URN (for posts) and current company (from experience).
async function fetchFullProfile(userId) {
  if (!userId) return null;
  try {
    const data = await anysiteFetch('/api/linkedin/user', {
      method: 'POST',
      body: JSON.stringify({ user: userId, timeout: 300, with_experience: true, with_education: false })
    });
    const p = Array.isArray(data) ? data[0] : (data && (data.data || data.user || data)) || null;
    if (!p) return null;
    const exp = firstExperience(p);
    return {
      firstName: p.first_name || p.firstName || '',
      lastName: p.last_name || p.lastName || '',
      headline: p.headline || '',
      profileUrn: urnString(p.urn || p.internal_id),
      company: (exp && (exp.company || exp.company_name || exp.name)) || '',
      companyUrn: urnString(exp && (exp.company_urn || exp.companyUrn || exp.urn))
    };
  } catch (err) {
    console.warn('[gtmos] fetchFullProfile failed:', err.message);
    return null;
  }
}

// Email -> LinkedIn profile, with a SQL-lookup fallback. Returns the bits we
// need, including the fsd_profile URN required for posts. Returns null if the
// email maps to no LinkedIn profile (personal email, role inbox, no coverage).
async function enrichPersonByEmail(email) {
  let p = await emailLookup('/api/linkedin/email/user', email);
  if (!p) p = await emailLookup('/api/linkedin/email/sql/user', email);
  if (!p) {
    console.log('[gtmos] enrichPersonByEmail: no LinkedIn profile for', email);
    return null;
  }

  {
    const exp = firstExperience(p);
    const company = (exp && (exp.company || exp.company_name || exp.name)) || p.company || '';
    const companyUrn = urnString(exp && (exp.company_urn || exp.companyUrn || exp.urn)) || '';

    const result = {
      firstName: p.first_name || p.firstName || '',
      lastName: p.last_name || p.lastName || '',
      title: (exp && (exp.title || exp.role)) || p.headline || '',
      company,
      companyUrn,
      profileUrn: urnString(p.urn || p.internal_id || p.profile_urn || p.entity_urn),
      linkedinUrl: p.url || p.profile_url || '',
      alias: p.alias || '',
      headline: p.headline || ''
    };

    // If the email lookup didn't give a profile URN (needed for posts), resolve
    // the full profile via the documented endpoint using the alias/URL.
    if (!result.profileUrn && (result.alias || result.linkedinUrl)) {
      const full = await fetchFullProfile(result.alias || result.linkedinUrl);
      if (full) {
        result.profileUrn = result.profileUrn || full.profileUrn;
        result.company = result.company || full.company;
        result.companyUrn = result.companyUrn || full.companyUrn;
        result.headline = result.headline || full.headline;
        result.firstName = result.firstName || full.firstName;
        result.lastName = result.lastName || full.lastName;
      }
    }

    console.log('[gtmos] enrichPersonByEmail:', {
      hasProfileUrn: !!result.profileUrn,
      firstName: result.firstName,
      company: result.company,
      hasCompanyUrn: !!result.companyUrn,
      responseKeys: p && typeof p === 'object' ? Object.keys(p).slice(0, 25) : null
    });

    return result;
  }
}

// Resolve a company from its WEBSITE/domain (independent of any person), via
// google/company which accepts a website as a keyword and can return the URN.
async function resolveCompanyByDomain(query) {
  if (!query) return null;
  const cacheKey = `coresolve:${String(query).toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/linkedin/google/company', {
      method: 'POST',
      body: JSON.stringify({ keywords: [query], with_urn: true, count: 3 })
    });
    const arr = Array.isArray(data) ? data : (data.results || data.data || []);
    const top = (Array.isArray(arr) ? arr : [])[0] || null;
    const result = top ? {
      name: top.title || top.name || '',
      alias: top.alias || '',
      urn: urnString(top.urn),
      url: top.url || ''
    } : null;
    console.log('[gtmos] resolveCompanyByDomain:', { query, found: !!result, name: result && result.name, hasUrn: !!(result && result.urn) });
    if (result) cache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[gtmos] resolveCompanyByDomain failed:', err.message);
    return null;
  }
}

// Recent posts for a profile. POST /api/linkedin/user/posts { urn, count }.
// `urn` MUST be the fsd_profile URN (from enrichPersonByEmail).
async function getLinkedInPosts(profileUrn, count = 20) {
  const urn = urnString(profileUrn);
  if (!urn) { console.log('[gtmos] getLinkedInPosts: no profile URN, skipping'); return []; }

  const cacheKey = `liposts:${urn}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/linkedin/user/posts', {
      method: 'POST',
      body: JSON.stringify({ urn, count })
    });

    const raw = Array.isArray(data) ? data : (data.posts || data.results || data.data || []);
    const posts = (Array.isArray(raw) ? raw : []).map((p) => ({
      text: p.text || p.commentary || p.content || '',
      date: tsToDate(p.created_at || p.posted_at || p.date),
      url: p.url || p.share_url || ''
    })).filter(p => p.text);

    console.log('[gtmos] getLinkedInPosts:', { urn: urn.slice(0, 24), got: Array.isArray(raw) ? raw.length : 0, withText: posts.length });
    cache.set(cacheKey, posts);
    return posts;
  } catch (err) {
    console.warn('[gtmos] getLinkedInPosts failed:', err.message);
    cache.set(cacheKey, []);
    return [];
  }
}

function tsToDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v; // seconds vs ms
    try { return new Date(ms).toISOString().slice(0, 10); } catch { return ''; }
  }
  return String(v);
}

// Company profile. POST /api/linkedin/company { company } where company is an
// alias, URL, or URN. Returns logo + name + urn (urn is needed for job search).
async function getCompanyProfile(identifier) {
  if (!identifier) return null;

  const cacheKey = `company:${String(identifier).toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/linkedin/company', {
      method: 'POST',
      body: JSON.stringify({ company: identifier, timeout: 300 })
    });

    const co = Array.isArray(data) ? (data[0] || {}) : (data && (data.company || data.data || data)) || {};
    const profile = {
      name: co.name || co.company_name || '',
      logoUrl: co.logo_url || co.logo || co.image || '',
      urn: urnString(co.urn),
      alias: co.alias || '',
      website: co.website || '',
      industry: co.industry || co.industry_full || '',
      employeeCount: co.employee_count || co.employee_count_range || '',
      description: String(co.short_description || co.description || '').slice(0, 800),
      headquarters: co.headquarter_location || ''
    };

    console.log('[gtmos] getCompanyProfile:', { identifier: String(identifier).slice(0, 40), name: profile.name, hasLogo: !!profile.logoUrl, hasUrn: !!profile.urn });
    cache.set(cacheKey, profile);
    return profile;
  } catch (err) {
    console.warn('[gtmos] getCompanyProfile failed:', err.message);
    return null;
  }
}

// Open jobs for a company. POST /api/linkedin/search/jobs { company, count }
// where company is a company URN (from getCompanyProfile.urn).
async function getCompanyJobs(companyUrn, count = 15) {
  const urn = urnString(companyUrn);
  if (!urn) { console.log('[gtmos] getCompanyJobs: no company URN, skipping'); return []; }

  const cacheKey = `jobs:${urn}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await anysiteFetch('/api/linkedin/search/jobs', {
      method: 'POST',
      // The live API wants `company` as a set (array of company URNs), not a string.
      body: JSON.stringify({ company: [urn], count })
    });

    const raw = Array.isArray(data) ? data : (data.jobs || data.results || data.data || []);
    const jobs = (Array.isArray(raw) ? raw : []).map((j) => ({
      title: j.name || j.title || j.job_title || '',
      location: j.location || '',
      url: j.url || ''
    })).filter(j => j.title);

    console.log('[gtmos] getCompanyJobs:', { urn: urn.slice(0, 24), got: jobs.length });
    cache.set(cacheKey, jobs);
    return jobs;
  } catch (err) {
    console.warn('[gtmos] getCompanyJobs failed:', err.message);
    cache.set(cacheKey, []);
    return [];
  }
}

module.exports = {
  enrichPersonByEmail,
  searchPerson,
  resolveCompanyByDomain,
  getLinkedInPosts,
  getCompanyProfile,
  getCompanyJobs,
  urnString
};
