function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let cleaned = url.trim().toLowerCase();
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = 'https://' + cleaned;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  try {
    const parsed = new URL(cleaned);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname.includes('.')) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Drop unpaired UTF-16 surrogates from a string.
//
// JSON cannot represent a lone surrogate: JSON.stringify emits it verbatim as an
// invalid \uD8xx escape with no paired \uDCxx, so the Anthropic API rejects the
// entire request body with 400 "The request body is not valid JSON: no low
// surrogate in string" and the analysis never completes. Scraped website copy and
// LinkedIn posts are full of emoji and other astral-plane characters (each a
// surrogate pair), and fixed-length truncation (slice/substring count UTF-16 code
// units, not code points) can cut a pair in half and leave an orphan. Removing any
// unpaired surrogate guarantees the payload always serializes to valid JSON.
function stripLoneSurrogates(text) {
  if (typeof text !== 'string') return text;
  // High surrogate not followed by a low surrogate, OR low surrogate not preceded
  // by a high surrogate. Well-formed pairs are left untouched.
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

module.exports = { validateEmail, sanitizeUrl, extractDomain, stripLoneSurrogates };
