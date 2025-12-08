export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, properties } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // First, search for existing contact
    const searchResponse = await fetch(
      'https://api.hubapi.com/crm/v3/objects/contacts/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{
              propertyName: 'email',
              operator: 'EQ',
              value: email
            }]
          }]
        })
      }
    );

    const searchData = await searchResponse.json();
    
    let contactId;
    
    if (searchData.total > 0) {
      // Update existing contact
      contactId = searchData.results[0].id;
      const updateResponse = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
          },
          body: JSON.stringify({ properties })
        }
      );
      
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        console.error('HubSpot update error:', errorData);
        return res.status(updateResponse.status).json({ error: errorData.message || 'Failed to update contact' });
      }
      
      const updateData = await updateResponse.json();
      return res.status(200).json({ success: true, contactId, action: 'updated', data: updateData });
      
    } else {
      // Create new contact
      const createResponse = await fetch(
        'https://api.hubapi.com/crm/v3/objects/contacts',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
          },
          body: JSON.stringify({ 
            properties: { 
              email,
              ...properties 
            } 
          })
        }
      );
      
      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        console.error('HubSpot create error:', errorData);
        return res.status(createResponse.status).json({ error: errorData.message || 'Failed to create contact' });
      }
      
      const createData = await createResponse.json();
      return res.status(200).json({ success: true, contactId: createData.id, action: 'created', data: createData });
    }
    
  } catch (error) {
    console.error('HubSpot API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
