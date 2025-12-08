export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { objectType = 'contacts', searchProperty, searchValue, properties, associateWith } = req.body;

  if (!searchValue) {
    return res.status(400).json({ error: 'searchValue is required' });
  }

  const baseUrl = 'https://api.hubapi.com/crm/v3/objects';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
  };

  try {
    // Search for existing record
    const searchResponse = await fetch(`${baseUrl}/${objectType}/search`, {
      method: 'POST',
      headers,
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
    let recordId;
    let action;
    
    if (searchData.total > 0) {
      // Update existing record
      recordId = searchData.results[0].id;
      action = 'updated';
      
      const updateResponse = await fetch(`${baseUrl}/${objectType}/${recordId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties })
      });
      
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        console.error('HubSpot update error:', errorData);
        return res.status(updateResponse.status).json({ error: errorData.message || 'Failed to update record' });
      }
      
    } else {
      // Create new record
      action = 'created';
      
      const createResponse = await fetch(`${baseUrl}/${objectType}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ properties })
      });
      
      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        console.error('HubSpot create error:', errorData);
        return res.status(createResponse.status).json({ error: errorData.message || 'Failed to create record' });
      }
      
      const createData = await createResponse.json();
      recordId = createData.id;
    }

    // Handle association if requested
    if (associateWith && associateWith.id && associateWith.type) {
      const associationUrl = `https://api.hubapi.com/crm/v4/objects/${objectType}/${recordId}/associations/${associateWith.type}/${associateWith.id}`;
      
      // Determine association type label
      let associationLabel;
      if (objectType === 'companies' && associateWith.type === 'contacts') {
        associationLabel = 'company_to_contact';
      } else if (objectType === 'contacts' && associateWith.type === 'companies') {
        associationLabel = 'contact_to_company';
      }
      
      const associationResponse = await fetch(associationUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify([
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: objectType === 'companies' ? 280 : 279
          }
        ])
      });
      
      if (!associationResponse.ok) {
        const assocError = await associationResponse.json();
        console.error('Association error:', assocError);
        // Don't fail the whole request, just log the error
      }
    }

    return res.status(200).json({ success: true, id: recordId, action });
    
  } catch (error) {
    console.error('HubSpot API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
