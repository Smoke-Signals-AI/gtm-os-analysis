const cache = new Map();

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttl = DEFAULT_TTL) {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

function has(key) {
  return get(key) !== null;
}

// Rate limiting: track submissions per email
const rateLimits = new Map();

function checkRateLimit(email, maxPerDay = 3) {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let entries = rateLimits.get(key) || [];
  entries = entries.filter(ts => now - ts < dayMs);

  if (entries.length >= maxPerDay) {
    return false;
  }

  entries.push(now);
  rateLimits.set(key, entries);
  return true;
}

module.exports = { get, set, has, checkRateLimit };
