const anthropic = require('./anthropic');

// ICP grading for Smoke Signals.
//
// The grade ladder (per sales' definition):
//   F  no HubSpot detected on their site, OR they are a HubSpot/growth/marketing
//      agency. Hard fails — nothing else is evaluated for the F.
//   C  has HubSpot and is not an agency (the floor for a pass; <10 employees
//      or unknown headcount stays here).
//   B  10-25 employees.
//   A  more than 25 employees.
// Title then adjusts downward only (it never promotes):
//   - below director (manager/analyst/associate/...): capped at B.
//   - title unknown: demoted one level (A->B, B->C; C is the floor, never a fail).
//   - director level or above: no change.
//
// "Buyers on LinkedIn" is captured as an informational signal (LinkedIn is core
// to our strategy) but does not move the grade.

const BANDS = new Set(['lt10', '10-25', 'gt25', 'unknown']);
const TITLE_LEVELS = new Set(['director_plus', 'below_director', 'unknown']);

// Director-and-above beats the below-director check: "Chief Executive Officer"
// must match here before "executive" pulls it down.
// "partner" excludes Partner Manager (a manager role); "principal" excludes
// senior-IC forms like Principal Engineer/Consultant, which are not director+.
const DIRECTOR_PLUS_RE = /\b(chief\s+\w+(\s+\w+)?\s+officer|c[aemftrsio]o|chro|founder|co-?founder|owner|president|partner(?!\s+manager)|principal(?!\s+(engineer|developer|consultant|analyst|scientist|architect|designer))|v\.?\s?p\.?|vice\s*president|director|head\s+of|general\s+manager|[es]vp|chairman|chairwoman|board\s+member)\b/i;
const BELOW_DIRECTOR_RE = /\b(manager|analyst|associate|coordinator|specialist|assistant|intern|representative|rep|consultant|administrator|executive|engineer|developer|designer|marketer|recruiter|strategist|scientist|architect)\b/i;

// Classify a person's seniority from their job title and/or LinkedIn headline.
function classifyTitleLevel(title, headline) {
  for (const text of [title, headline]) {
    if (!text || typeof text !== 'string') continue;
    if (DIRECTOR_PLUS_RE.test(text)) return 'director_plus';
    if (BELOW_DIRECTOR_RE.test(text)) return 'below_director';
  }
  return 'unknown';
}

// Fallback headcount banding from LinkedIn's employee count, which arrives as a
// number ("45"), a range ("11-50"), or prose ("51-200 employees"). Ranges use
// the midpoint, so "11-50" (mid 30) grades as >25 rather than punishing a
// 40-person company for LinkedIn's bucket edges.
function parseHeadcountBand(employeeCount) {
  const s = String(employeeCount == null ? '' : employeeCount);
  const nums = (s.match(/\d[\d,]*/g) || []).map(n => parseInt(n.replace(/,/g, ''), 10)).filter(Number.isFinite);
  if (!nums.length) return { band: 'unknown', estimate: null };
  const value = nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
  if (value < 10) return { band: 'lt10', estimate: value };
  if (value <= 25) return { band: '10-25', estimate: value };
  return { band: 'gt25', estimate: value };
}

const BAND_LABELS = { lt10: 'under 10', '10-25': '10-25', gt25: 'more than 25', unknown: 'unknown' };

// Pure grade computation. Returns { grade, reasons } where reasons is a human
// audit trail written to HubSpot and shown in the Slack notification.
function computeIcpGrade({ usesHubSpot, isAgency, agencyReason, headcountBand, titleLevel, title }) {
  if (!usesHubSpot) {
    return { grade: 'F', reasons: ['No HubSpot detected on their website'] };
  }
  const reasons = ['HubSpot detected'];
  if (isAgency) {
    reasons.push(`Agency${agencyReason ? ` — ${agencyReason}` : ''}`);
    return { grade: 'F', reasons };
  }
  reasons.push('Not an agency');

  let grade = 'C';
  if (headcountBand === '10-25') grade = 'B';
  else if (headcountBand === 'gt25') grade = 'A';
  reasons.push(`Headcount: ${BAND_LABELS[headcountBand] || 'unknown'}`);

  const titleText = title ? ` (${title})` : '';
  if (titleLevel === 'below_director') {
    if (grade === 'A') {
      grade = 'B';
      reasons.push(`Title below director${titleText} — capped at B`);
    } else {
      reasons.push(`Title below director${titleText}`);
    }
  } else if (titleLevel === 'unknown') {
    if (grade === 'A') { grade = 'B'; reasons.push('Title unknown — demoted A to B'); }
    else if (grade === 'B') { grade = 'C'; reasons.push('Title unknown — demoted B to C'); }
    else reasons.push('Title unknown (C is the floor, no demotion)');
  } else {
    reasons.push(`Title director+${titleText}`);
  }

  return { grade, reasons };
}

// Full evaluation for one submission. Never throws on classifier trouble: the
// AI call is best-effort and every field it feeds has a deterministic fallback.
// Only runs the (paid) classifier when the company actually has HubSpot — a
// no-HubSpot submission is an automatic F and needs no further evaluation.
async function evaluateIcp({ usesHubSpot, websiteResearch, domain, companyProfile, enrichedPerson }) {
  const title = (enrichedPerson && enrichedPerson.title) || '';
  const headline = (enrichedPerson && enrichedPerson.headline) || '';

  if (!usesHubSpot) {
    const { grade, reasons } = computeIcpGrade({ usesHubSpot: false });
    return {
      grade, reasons,
      isAgency: null,
      headcountBand: 'unknown',
      headcountEstimate: null,
      titleLevel: 'unknown',
      buyersOnLinkedIn: 'unknown',
      buyersOnLinkedInReason: '',
      detail: `Grade ${grade}: ` + reasons.join('; ')
    };
  }

  let ai = null;
  try {
    ai = await anthropic.classifyICP({ websiteResearch, domain, companyProfile, enrichedPerson });
  } catch (err) {
    console.warn('[gtmos] ICP classifier failed, using deterministic fallbacks:', err.message);
  }

  // Agency verdict comes only from the classifier reading the website. If the
  // classifier is unavailable we do NOT fail them — missing data never fails ICP.
  const isAgency = !!(ai && ai.isAgency);
  const agencyReason = (ai && ai.agencyReason) || '';

  // Headcount: prefer the classifier (it reads the website AND the LinkedIn
  // facts); fall back to parsing LinkedIn's employee count directly.
  const parsed = parseHeadcountBand(companyProfile && companyProfile.employeeCount);
  let headcountBand = ai && BANDS.has(ai.headcountBand) && ai.headcountBand !== 'unknown' ? ai.headcountBand : parsed.band;
  const headcountEstimate = (ai && Number.isFinite(ai.headcountEstimate) && ai.headcountEstimate > 0)
    ? ai.headcountEstimate : parsed.estimate;

  // Title: deterministic keyword match on the enriched title/headline first;
  // the classifier only breaks ties the keywords couldn't call.
  let titleLevel = classifyTitleLevel(title, headline);
  if (titleLevel === 'unknown' && ai && TITLE_LEVELS.has(ai.titleLevel)) {
    titleLevel = ai.titleLevel;
  }

  const buyersOnLinkedIn = (ai && ['yes', 'no', 'unknown'].includes(ai.buyersOnLinkedIn)) ? ai.buyersOnLinkedIn : 'unknown';
  const buyersOnLinkedInReason = (ai && ai.buyersOnLinkedInReason) || '';

  const { grade, reasons } = computeIcpGrade({
    usesHubSpot: true, isAgency, agencyReason, headcountBand, titleLevel, title: title || headline
  });

  if (buyersOnLinkedIn !== 'unknown') {
    reasons.push(`Buyers on LinkedIn: ${buyersOnLinkedIn}${buyersOnLinkedInReason ? ` — ${buyersOnLinkedInReason}` : ''}`);
  }

  return {
    grade, reasons,
    isAgency,
    headcountBand,
    headcountEstimate,
    titleLevel,
    buyersOnLinkedIn,
    buyersOnLinkedInReason,
    detail: `Grade ${grade}: ` + reasons.join('; ')
  };
}

module.exports = { evaluateIcp, computeIcpGrade, classifyTitleLevel, parseHeadcountBand };
