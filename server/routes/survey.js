const express = require('express');
const hubspot = require('../services/hubspot');
const { validateEmail } = require('../utils/validation');

const router = express.Router();

const MAX_ITEMS = 25;
const MAX_LEN = 200;

// Coerce arbitrary request input into a clean, bounded list of strings before it
// ever reaches the CRM. Drops non-strings, caps count and per-item length.
function cleanList(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(x => typeof x === 'string')
    .slice(0, MAX_ITEMS)
    .map(s => s.slice(0, MAX_LEN));
}

router.post('/survey', async (req, res) => {
  const { email, tools, capture } = req.body || {};

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  const toolsList = cleanList(tools);
  const captureList = cleanList(capture);

  try {
    const contact = await hubspot.searchContactByEmail(email);
    if (contact) {
      const properties = {};
      if (toolsList.length > 0) {
        properties.gtmos_tools_tried = toolsList.join('; ');
      }
      if (captureList.length > 0) {
        properties.gtmos_demand_capture_owner = captureList.join('; ');
      }
      if (Object.keys(properties).length > 0) {
        await hubspot.updateContact(contact.id, properties);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    // Don't break the user experience, but surface the failure to monitoring
    // (ok:false) instead of masking every error as success.
    console.error('Survey save error:', err.message);
    res.json({ ok: false });
  }
});

module.exports = router;
