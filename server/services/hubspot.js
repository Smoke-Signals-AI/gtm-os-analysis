const HUBSPOT_BASE = 'https://api.hubapi.com';

function headers() {
  return {
    'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

async function hubspotFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${HUBSPOT_BASE}${path}`, {
      ...options,
      headers: { ...headers(), ...options.headers },
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Include the response body in the message: bare "HubSpot API error: 400"
      // in the logs is what let a rejected payload go unnoticed for days.
      const detail = data && Object.keys(data).length ? ` ${JSON.stringify(data).slice(0, 400)}` : '';
      const err = new Error(`HubSpot API error: ${res.status}${detail}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchContactByEmail(email) {
  const body = {
    filterGroups: [{
      filters: [{
        propertyName: 'email',
        operator: 'EQ',
        value: email
      }]
    }],
    properties: ['email', 'firstname', 'lastname', 'jobtitle', 'company', 'hs_object_id', 'gtmos_completed_at', 'gtmos_report_url']
  };
  const result = await hubspotFetch('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return result.total > 0 ? result.results[0] : null;
}

async function createContact(properties) {
  return hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties })
  });
}

async function updateContact(contactId, properties) {
  return hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });
}

// Pull the property names HubSpot flagged as invalid out of a 400 response.
// The body's message embeds a JSON array of per-property validation results
// ('Property values were not valid: [{"isValid":false,"name":...,...}]');
// fall back to scanning for 'Property "x" does not exist' if that shape changes.
function invalidPropertyNames(err) {
  if (!err || err.status !== 400) return [];
  const msg = String((err.data && err.data.message) || '');
  const names = new Set();
  const start = msg.indexOf('[');
  const end = msg.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      for (const item of JSON.parse(msg.slice(start, end + 1))) {
        if (item && item.isValid === false && item.name) names.add(item.name);
      }
    } catch (_) { /* not the embedded-JSON shape */ }
  }
  for (const m of msg.matchAll(/Property \\?"([^"\\]+)\\?" does not exist/g)) {
    names.add(m[1]);
  }
  return [...names];
}

// Run a contact write, dropping any properties HubSpot rejects and retrying
// with the rest. One deleted or retyped portal property must cost that one
// field, not the whole lead payload — a full-payload 400 here is exactly how
// every analysis write silently failed after a portal property cleanup.
async function writeDroppingInvalidProps(makeCall, properties, context) {
  let props = { ...properties };
  while (true) {
    try {
      return await makeCall(props);
    } catch (err) {
      const bad = invalidPropertyNames(err).filter(n => Object.prototype.hasOwnProperty.call(props, n));
      if (!bad.length) throw err;
      console.error(`[gtmos] HubSpot rejected ${context} propert${bad.length > 1 ? 'ies' : 'y'} ${bad.join(', ')} — retrying without. Those values are being LOST on every write until the portal property is fixed.`);
      for (const n of bad) delete props[n];
      if (!Object.keys(props).length) throw err;
    }
  }
}

async function ensurePropertyGroup() {
  try {
    await hubspotFetch('/crm/v3/properties/contacts/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: 'gtm_os',
        label: 'GTM OS'
      })
    });
  } catch (err) {
    // Group may already exist
    if (err.status !== 409) {
      console.warn('Could not create property group:', err.data?.message || err.message);
    }
  }
}

// Labels only matter at creation time: ensureProperties only creates names
// that don't exist yet, and properties that already exist keep whatever label
// the portal has (most were renamed to a "GTM OS - " prefix in a June 2026
// portal cleanup).
// NOTE: no gtmos_linkedin_url here. It was deleted in the portal (June 2026
// property cleanup) and HubSpot reserves archived property names, so recreating
// it fails; the LinkedIn URL is written to the standard hs_linkedin_url instead.
const GTMOS_PROPERTIES = [
  { name: 'gtmos_website_url', label: 'Website URL', type: 'string', fieldType: 'text' },
  { name: 'gtmos_report_url', label: 'GTM OS - Report URL', type: 'string', fieldType: 'text' },
  { name: 'gtmos_referred_report_url', label: 'GTM OS - Referred Report URL', type: 'string', fieldType: 'text' },
  { name: 'gtmos_lead_source', label: 'GTM OS - Lead Source', type: 'string', fieldType: 'text' },
  { name: 'gtmos_icp_profile', label: 'ICP Profile', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_usp_analysis', label: 'USP Analysis', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_alpha_signal', label: 'Alpha Signal', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_outbound_sequence', label: 'Outbound Sequence', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_content_strategy', label: 'Content Strategy', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_report_narrative', label: 'Report Narrative', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_crm', label: 'CRM', type: 'string', fieldType: 'text' },
  { name: 'gtmos_company_research', label: 'Company Research', type: 'string', fieldType: 'textarea' },
  // datetime, not date: the portal property was retyped to datetime in the
  // June 2026 cleanup, and the definition here must match what exists.
  { name: 'gtmos_completed_at', label: 'GTM OS - Completed At', type: 'datetime', fieldType: 'date' },
  { name: 'gtmos_model_used', label: 'Model Used', type: 'string', fieldType: 'text' },
  { name: 'gtmos_tools_tried', label: 'GTM Tools Tried', type: 'string', fieldType: 'text' },
  { name: 'gtmos_demand_capture_owner', label: 'Demand Capture Owner', type: 'string', fieldType: 'text' }
];

async function ensureProperties() {
  await ensurePropertyGroup();

  let existing;
  try {
    const res = await hubspotFetch('/crm/v3/properties/contacts');
    existing = new Set(res.results.map(p => p.name));
  } catch {
    existing = new Set();
  }

  for (const prop of GTMOS_PROPERTIES) {
    if (existing.has(prop.name)) continue;
    try {
      await hubspotFetch('/crm/v3/properties/contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: prop.name,
          label: prop.label,
          type: prop.type,
          fieldType: prop.fieldType,
          groupName: 'gtm_os'
        })
      });
    } catch (err) {
      console.warn(`Could not create property ${prop.name}:`, err.data?.message || err.message);
    }
  }
}

async function pushAnalysisToContact(contactId, analysisData) {
  const properties = {
    gtmos_website_url: analysisData.websiteUrl || '',
    gtmos_report_url: analysisData.reportUrl || '',
    gtmos_icp_profile: truncate(analysisData.icpProfile),
    gtmos_usp_analysis: truncate(analysisData.uspAnalysis),
    gtmos_alpha_signal: truncate(analysisData.alphaSignal),
    gtmos_outbound_sequence: truncate(analysisData.outboundSequence),
    gtmos_content_strategy: truncate(analysisData.contentStrategy),
    gtmos_report_narrative: truncate(analysisData.reportNarrative),
    gtmos_crm: analysisData.usesHubSpot ? 'HubSpot' : 'Other/Unknown',
    gtmos_company_research: truncate(analysisData.companyResearch),
    // Full ISO timestamp: the portal property is datetime (see GTMOS_PROPERTIES).
    // completedAt override exists so the backfill script can stamp the original
    // analysis time instead of the time the backfill ran.
    gtmos_completed_at: analysisData.completedAt || new Date().toISOString(),
    gtmos_model_used: analysisData.modelUsed || 'sonnet-4.5'
  };
  // hs_linkedin_url is HubSpot's standard property and is shared with other
  // integrations (e.g. Hublead), so only set it when we actually found a URL —
  // an empty string would wipe a value someone else wrote.
  if (analysisData.linkedinUrl) {
    properties.hs_linkedin_url = analysisData.linkedinUrl;
  }
  return writeDroppingInvalidProps(p => updateContact(contactId, p), properties, 'analysis');
}

function truncate(str, max = 65000) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) : str;
}

// Capture a visitor who unlocked a shared report behind the email gate. Upserts
// the contact by email and records which report they viewed (for attribution).
// New contacts are tagged with a lead source; existing contacts keep whatever
// source they already had, so a shared-report view never reclassifies a lead.
async function recordSharedReportView({ email, reportUrl }) {
  const existing = await searchContactByEmail(email);
  if (existing) {
    return writeDroppingInvalidProps(
      p => updateContact(existing.id, p),
      { gtmos_referred_report_url: reportUrl || '' },
      'shared-report view'
    );
  }
  // email stays outside the droppable set: a capture without the email is
  // pointless, so if HubSpot ever rejects it the create should fail outright.
  return writeDroppingInvalidProps(
    p => createContact({ ...p, email }),
    {
      gtmos_referred_report_url: reportUrl || '',
      gtmos_lead_source: 'Shared GTM OS Report'
    },
    'shared-report lead'
  );
}

module.exports = {
  searchContactByEmail,
  createContact,
  updateContact,
  ensureProperties,
  pushAnalysisToContact,
  recordSharedReportView
};
