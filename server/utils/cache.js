// Short-lived in-process cache for external API responses (LinkedIn/company
// lookups). Single-instance only; that is fine because it is a latency/cost
// optimization, not a source of truth. Durable state lives in the store.

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

// Background sweep so entries written once and never read again are still
// reclaimed (get() only evicts lazily, on access). unref so it never keeps the
// process alive on its own.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (now > entry.expiresAt) cache.delete(k);
  }
}, 60 * 60 * 1000);
if (sweep.unref) sweep.unref();

module.exports = { get, set, has };
