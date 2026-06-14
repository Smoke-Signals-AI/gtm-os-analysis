// Durable key/value store for analyses and chat sessions.
//
// Uses Redis when REDIS_URL is set; otherwise falls back to an in-process Map
// (fine for local dev and single-instance runs, but cleared on restart). The
// API is async either way, so callers don't care which backend is live.

let redis = null;
let redisReady = false;

if (process.env.REDIS_URL) {
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
}

const mem = new Map();
const DEFAULT_TTL = 30 * 24 * 60 * 60; // 30 days (seconds)

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
  mem.set(key, value);
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
  return mem.has(key) ? mem.get(key) : null;
}

module.exports = { setJSON, getJSON, isRedis: up };
