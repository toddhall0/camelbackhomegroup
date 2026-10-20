// Fetches active residential listings from SimplyRETS within a bounding box
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
  const token = process.env.SIMPLYRETS_TOKEN;

  if (!token && (!apiKey || !apiSecret)) {
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

  const { south, north, west, east, limit } = body;
  if (!south || !north || !west || !east) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Bounding box required" }) };
  }

  try {
    const maxResults = Math.min(limit || 50, 200);
    const authHeader = token
      ? `Bearer ${token}`
      : `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

    const params = new URLSearchParams({
      "status": "active",
      "type": "residential",
      "limit": String(maxResults),
      "sort": "-listprice",
    });

    // points requires a polygon (min 3 points) — use 4 corners of bounding box
    params.append("points", `${south},${west}`);
    params.append("points", `${north},${west}`);
    params.append("points", `${north},${east}`);
    params.append("points", `${south},${east}`);
    });

    const url = `https://api.simplyrets.com/properties?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": authHeader,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ listings: [], error: `API returned ${response.status}` }),
      };
    }

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
        beds: p.property ? p.property.bedrooms : null,
        baths: p.property ? p.property.bathsFull : null,
        sqft: p.property ? p.property.area : null,
        photo: p.photos && p.photos.length > 0 ? p.photos[0] : null,
        status: p.mls ? p.mls.status : "Active",
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ listings }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ listings: [], error: "Failed to fetch listings" }),
    };
  }
};
