const express = require('express');
const hubspot = require('../services/hubspot');

const router = express.Router();

router.post('/survey', async (req, res) => {
  const { email, tools, capture } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const contact = await hubspot.searchContactByEmail(email);
    if (contact) {
      const properties = {};
      if (Array.isArray(tools) && tools.length > 0) {
        properties.gtmos_tools_tried = tools.join('; ');
      }
      if (Array.isArray(capture) && capture.length > 0) {
        properties.gtmos_demand_capture_owner = capture.join('; ');
      }
      if (Object.keys(properties).length > 0) {
        await hubspot.updateContact(contact.id, properties);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.warn('Survey save error:', err.message);
    res.json({ ok: true }); // Don't fail the user experience
  }
});

module.exports = router;
