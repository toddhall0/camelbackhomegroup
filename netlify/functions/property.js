// Fetches a single property by MLS ID from SimplyRETS

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const apiKey = process.env.SIMPLYRETS_API_KEY;
  const apiSecret = process.env.SIMPLYRETS_API_SECRET;

  if (!apiKey || !apiSecret) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "API not configured" }) };
  }

  const mlsId = event.queryStringParameters && event.queryStringParameters.id;
  if (!mlsId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "MLS ID required" }) };
  }

  try {
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
    const url = `https://api.simplyrets.com/properties/${mlsId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Basic ${auth}`, "Accept": "application/json" },
    });

    if (!response.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: `Not found (${response.status})` }) };
    }

    const p = await response.json();

    const listing = {
      id: p.mlsId || p.listingId,
      mlsNumber: p.listingId || '',
      price: p.listPrice,
      address: p.address ? `${p.address.streetNumberText || ""} ${p.address.streetName || ""} ${p.address.streetSuffix || ""}`.trim() : "",
      city: p.address ? p.address.city : "",
      state: p.address ? p.address.state : "",
      zip: p.address ? p.address.postalCode : "",
      county: p.address ? p.address.county : "",
      beds: p.property ? p.property.bedrooms : null,
      baths: p.property ? p.property.bathsFull : null,
      halfBaths: p.property ? p.property.bathsHalf : null,
      sqft: p.property ? p.property.area : null,
      lotSize: p.property ? p.property.lotSize : null,
      lotAcres: p.property && p.property.lotSize ? (p.property.lotSize / 43560).toFixed(2) : null,
      yearBuilt: p.property ? p.property.yearBuilt : null,
      stories: p.property ? p.property.stories : null,
      garageSpaces: p.property ? p.property.garageSpaces : null,
      pool: p.property ? p.property.pool : null,
      heating: p.property ? p.property.heating : null,
      cooling: p.property ? p.property.cooling : null,
      style: p.property ? p.property.style : null,
      subdivision: p.property ? p.property.subdivision : null,
      propertyType: p.property ? p.property.subType : null,
      photos: p.photos || [],
      description: p.remarks || "",
      listDate: p.listDate || null,
      status: p.mls ? p.mls.status : "Active",
      daysOnMarket: p.mls ? p.mls.daysOnMarket : null,
      agent: p.agent ? { name: p.agent.firstName + " " + p.agent.lastName, office: p.agent.officeName } : null,
      lat: p.geo ? p.geo.lat : null,
      lng: p.geo ? p.geo.lng : null,
      features: p.property ? p.property.exteriorFeatures : null,
      interiorFeatures: p.property ? p.property.interiorFeatures : null,
    };

    return { statusCode: 200, headers, body: JSON.stringify({ listing }) };
  } catch {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Failed to fetch property" }) };
  }
};
