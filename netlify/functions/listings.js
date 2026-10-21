// Fetches active residential listings from SimplyRETS within a polygon
//
// Env vars required:
//   SIMPLYRETS_API_KEY
//   SIMPLYRETS_API_SECRET

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.SIMPLYRETS_API_KEY;
  const apiSecret = process.env.SIMPLYRETS_API_SECRET;

  if (!apiKey || !apiSecret) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ listings: [], error: "API not configured" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { south, north, west, east, limit, polygon, minPrice, maxPrice, minBeds, minBaths, minSqft, maxSqft, sort, q } = body;
  if (!q && !polygon && (!south || !north || !west || !east)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Search query, bounding box, or polygon required" }) };
  }

  try {
    const maxResults = Math.min(limit || 200, 500);
    const authHeader = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

    const params = new URLSearchParams({
      "status": "active",
      "type": "residential",
      "limit": String(maxResults),
      "sort": sort || "-listprice",
    });

    if (minPrice) params.set("minprice", String(minPrice));
    if (maxPrice) params.set("maxprice", String(maxPrice));
    if (minBeds) params.set("minbeds", String(minBeds));
    if (minBaths) params.set("minbaths", String(minBaths));
    if (minSqft) params.set("minarea", String(minSqft));
    if (maxSqft) params.set("maxarea", String(maxSqft));

    if (q) {
      params.set("q", q);
    } else if (polygon && Array.isArray(polygon)) {
      polygon.forEach(function(pt) {
        params.append("points", `${pt[0]},${pt[1]}`);
      });
    } else if (south && north && west && east) {
      params.append("points", `${south},${west}`);
      params.append("points", `${north},${west}`);
      params.append("points", `${north},${east}`);
      params.append("points", `${south},${east}`);
    }

    const url = `https://api.simplyrets.com/properties?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": authHeader,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ listings: [], error: `API returned ${response.status}` }),
      };
    }

    const total = response.headers.get("X-Total-Count");
    const data = await response.json();

    const listings = data
      .filter((p) => p.geo && p.geo.lat && p.geo.lng)
      .map((p) => ({
        id: p.mlsId || p.listingId,
        lat: p.geo.lat,
        lng: p.geo.lng,
        price: p.listPrice,
        address: p.address ? `${p.address.streetNumberText || ""} ${p.address.streetName || ""} ${p.address.streetSuffix || ""}`.trim() : "",
        city: p.address ? p.address.city : "",
        zip: p.address ? p.address.postalCode : "",
        beds: p.property ? p.property.bedrooms : null,
        baths: p.property ? p.property.bathsFull : null,
        halfBaths: p.property ? p.property.bathsHalf : null,
        sqft: p.property ? p.property.area : null,
        lotSize: p.property ? p.property.lotSize : null,
        yearBuilt: p.property ? p.property.yearBuilt : null,
        photo: p.photos && p.photos.length > 0 ? p.photos[0] : null,
        photos: p.photos ? p.photos.slice(0, 5) : [],
        status: p.mls ? p.mls.status : "Active",
        listDate: p.listDate || null,
        propertyType: p.property ? p.property.subType : null,
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ listings, total: total ? parseInt(total) : listings.length }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ listings: [], error: "Failed to fetch listings" }),
    };
  }
};
