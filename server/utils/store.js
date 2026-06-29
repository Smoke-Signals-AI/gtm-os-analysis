// Durable key/value store for analyses and chat sessions.
//
// Uses Redis when REDIS_URL is set; otherwise falls back to an in-process Map
// (fine for local dev and single-instance runs, but cleared on restart and not
// shared across replicas). The API is async either way, so callers don't care
// which backend is live.

let redis = null;
let redisReady = false;
const redisConfigured = Boolean(process.env.REDIS_URL);

if (redisConfigured) {
  try {
    const { createClient } = require('redis');
    redis = createClient({
      url: process.env.REDIS_URL,
      // Railway's private URL (redis.railway.internal) resolves over IPv6 only.
      // family: 0 lets node-redis resolve both A and AAAA records. Harmless on
      // the public IPv4 URL, so it works either way.
      socket: { family: 0 }
    });
    redis.on('error', (e) => { redisReady = false; console.warn('Redis error:', e.message); });
    redis.on('ready', () => { redisReady = true; });
    redis.connect()
      .then(() => { redisReady = true; console.log('Redis connected'); })
      .catch((e) => { redisReady = false; console.warn('Redis connect failed, using in-memory store:', e.message); });
  } catch (e) {
    console.warn('redis module unavailable, using in-memory store:', e.message);
  }
} else if (process.env.NODE_ENV === 'production') {
  // Loud, because this is the difference between durable reports and reports that
  // vanish on every deploy and are invisible to other instances.
  console.warn('[gtmos] REDIS_URL is not set. Running on the IN-MEMORY store: saved reports, chat sessions, and rate limits are lost on every restart/deploy and are NOT shared across instances. Set REDIS_URL in production.');
}

// In-memory fallback. Entries carry an absolute expiry so the map cannot grow
// without bound and stale reports are reclaimed (mirrors Redis EX semantics).
const mem = new Map();
const DEFAULT_TTL = 30 * 24 * 60 * 60; // 30 days (seconds)

function memSet(key, value, ttlSec) {
  mem.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}
function memGet(key) {
  const e = mem.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { mem.delete(key); return null; }
  return e.value;
}

// In-process rate-limit buckets (only used when Redis is unavailable).
const memHits = new Map();

// Background sweep so write-once-never-read keys are still reclaimed (memGet only
// evicts lazily on access). unref so it never keeps the process alive on its own.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, e] of mem) { if (now > e.expiresAt) mem.delete(k); }
  for (const [k, hits] of memHits) {
    const live = hits.filter(ts => now - ts < 24 * 60 * 60 * 1000);
    if (live.length) memHits.set(k, live); else memHits.delete(k);
  }
}, 60 * 60 * 1000);
if (sweep.unref) sweep.unref();

function up() { return Boolean(redis && redisReady); }

async function setJSON(key, value, ttlSec = DEFAULT_TTL) {
  if (up()) {
    try {
      await redis.set(key, JSON.stringify(value), { EX: ttlSec });
      return;
    } catch (e) {
      console.warn('Redis set failed, falling back to memory:', e.message);
    }
  }
  memSet(key, value, ttlSec);
}

async function getJSON(key) {
  if (up()) {
    try {
      const v = await redis.get(key);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      console.warn('Redis get failed, falling back to memory:', e.message);
    }
  }
  return memGet(key);
}

// Fixed-window rate limit. Redis-backed (durable + shared across replicas) when
// available, else an in-process sliding window. Returns true if the call is
// allowed, false if the limit is exceeded. Never throws.
async function checkRateLimit(id, max, windowSec) {
  const key = String(id || '').toLowerCase().trim();
  if (!key) return true;
  if (up()) {
    try {
      const rk = `rl:${key}`;
      const n = await redis.incr(rk);
      if (n === 1) await redis.expire(rk, windowSec);
      return n <= max;
    } catch (e) {
      console.warn('Redis rate-limit failed, falling back to memory:', e.message);
    }
  }
  const now = Date.now();
  const winMs = windowSec * 1000;
  const hits = (memHits.get(key) || []).filter(ts => now - ts < winMs);
  if (hits.length >= max) { memHits.set(key, hits); return false; }
  hits.push(now);
  memHits.set(key, hits);
  return true;
}

// For /health: is a durable backend configured, and is it currently connected?
function health() {
  return { configured: redisConfigured, ready: up() };
}

module.exports = { setJSON, getJSON, isRedis: up, checkRateLimit, health };
