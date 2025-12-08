export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { objectType = 'contacts', searchProperty, searchValue, properties } = req.body;

  if (!searchValue) {
    return res.status(400).json({ error: 'searchValue is required' });
  }

  const baseUrl = 'https://api.hubapi.com/crm/v3/objects';

  try {
    // Search for existing record
    const searchResponse = await fetch(`${baseUrl}/${objectType}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: searchProperty,
            operator: 'EQ',
            value: searchValue
          }]
        }]
      })
    });

    const searchData = await searchResponse.json();
    
    if (searchData.total > 0) {
      // Update existing record
      const recordId = searchData.results[0].id;
      const updateResponse = await fetch(`${baseUrl}/${objectType}/${recordId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
        },
        body: JSON.stringify({ properties })
      });
      
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        console.error('HubSpot update error:', errorData);
        return res.status(updateResponse.status).json({ error: errorData.message || 'Failed to update record' });
      }
      
      const updateData = await updateResponse.json();
      return res.status(200).json({ success: true, id: recordId, action: 'updated', data: updateData });
      
    } else {
      // Create new record
      const createResponse = await fetch(`${baseUrl}/${objectType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
        },
        body: JSON.stringify({ properties })
      });
      
      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        console.error('HubSpot create error:', errorData);
        return res.status(createResponse.status).json({ error: errorData.message || 'Failed to create record' });
      }
      
      const createData = await createResponse.json();
      return res.status(200).json({ success: true, id: createData.id, action: 'created', data: createData });
    }
    
  } catch (error) {
    console.error('HubSpot API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
