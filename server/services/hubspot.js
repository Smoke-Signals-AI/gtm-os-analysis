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
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(`HubSpot API error: ${res.status}`);
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
    properties: ['email', 'firstname', 'lastname', 'jobtitle', 'company', 'hs_object_id']
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

const GTMOS_PROPERTIES = [
  { name: 'gtmos_website_url', label: 'Website URL', type: 'string', fieldType: 'text' },
  { name: 'gtmos_icp_profile', label: 'ICP Profile', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_usp_analysis', label: 'USP Analysis', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_alpha_signal', label: 'Alpha Signal', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_outbound_sequence', label: 'Outbound Sequence', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_content_strategy', label: 'Content Strategy', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_report_narrative', label: 'Report Narrative', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_crm', label: 'CRM', type: 'string', fieldType: 'text' },
  { name: 'gtmos_company_research', label: 'Company Research', type: 'string', fieldType: 'textarea' },
  { name: 'gtmos_completed_at', label: 'Completed At', type: 'date', fieldType: 'date' },
  { name: 'gtmos_model_used', label: 'Model Used', type: 'string', fieldType: 'text' }
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
    gtmos_icp_profile: truncate(analysisData.icpProfile),
    gtmos_usp_analysis: truncate(analysisData.uspAnalysis),
    gtmos_alpha_signal: truncate(analysisData.alphaSignal),
    gtmos_outbound_sequence: truncate(analysisData.outboundSequence),
    gtmos_content_strategy: truncate(analysisData.contentStrategy),
    gtmos_report_narrative: truncate(analysisData.reportNarrative),
    gtmos_crm: analysisData.usesHubSpot ? 'HubSpot' : 'Other/Unknown',
    gtmos_company_research: truncate(analysisData.companyResearch),
    gtmos_completed_at: new Date().toISOString().split('T')[0],
    gtmos_model_used: analysisData.modelUsed || 'sonnet-4.5'
  };
  return updateContact(contactId, properties);
}

function truncate(str, max = 65000) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) : str;
}

module.exports = {
  searchContactByEmail,
  createContact,
  updateContact,
  ensureProperties,
  pushAnalysisToContact
};
