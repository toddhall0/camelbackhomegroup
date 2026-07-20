// Netlify serverless function — proxies property valuation requests
// to RealtyMole API (via RapidAPI) so the API key stays hidden.
//
// SETUP:
// 1. Sign up at https://rapidapi.com/realtymole/api/realty-mole-property-api
// 2. Subscribe to the free tier (up to 50 requests/month)
// 3. In Netlify dashboard → Site settings → Environment variables, add:
//    REALTYMOLE_API_KEY = your-rapidapi-key-here

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

  const apiKey = process.env.REALTYMOLE_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        estimated: false,
        message: "Valuation API not configured yet. Your information has been submitted and our team will prepare a personalized valuation for you.",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const address = body.address;
  if (!address) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Address is required" }) };
  }

  try {
    const url = `https://realty-mole-property-api.p.rapidapi.com/salePrice?address=${encodeURIComponent(address)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "realty-mole-property-api.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          estimated: false,
          message: "We couldn't find enough data for that address. Our team will prepare a personalized valuation and reach out to you shortly.",
        }),
      };
    }

    const data = await response.json();
    const price = data.price || data.estimatedValue || data.value;
    const low = price ? Math.round(price * 0.93) : null;
    const high = price ? Math.round(price * 1.07) : null;

    if (!price) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          estimated: false,
          message: "We couldn't generate an automated estimate for this property. Our team will prepare a personalized CMA and reach out shortly.",
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        estimated: true,
        price: price,
        low: low,
        high: high,
        address: address,
      }),
    };
  } catch {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        estimated: false,
        message: "We're experiencing a temporary issue. Your information has been saved and our team will prepare your valuation manually.",
      }),
    };
  }
};
