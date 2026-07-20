// Netlify serverless function — proxies property valuation requests
// to Redfin Scraper API (via RapidAPI) so the API key stays hidden.
//
// SETUP:
// 1. Sign up at https://rapidapi.com and subscribe to "Redfin Scraper API"
// 2. In Netlify dashboard → Site settings → Environment variables, add:
//    RAPIDAPI_KEY = your-rapidapi-key-here

const API_HOST = "redfin-scraper-api.p.rapidapi.com";

async function redfinFetch(path, apiKey) {
  const res = await fetch(`https://${API_HOST}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": API_HOST,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

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

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        estimated: false,
        message: "Your information has been submitted! Our team will prepare a personalized valuation and reach out shortly.",
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
    // Step 1: Search for the property by address to get the Redfin property ID
    const searchData = await redfinFetch(
      `/redfin/search?query=${encodeURIComponent(address)}`,
      apiKey
    );

    if (!searchData) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          estimated: false,
          message: "We couldn't find that address in our database. Our team will prepare a personalized valuation and reach out to you shortly.",
        }),
      };
    }

    // Extract property ID from search results
    let propertyId = null;

    // Handle different response structures
    if (searchData.data && Array.isArray(searchData.data) && searchData.data.length > 0) {
      propertyId = searchData.data[0].propertyId || searchData.data[0].listingId || searchData.data[0].id;
    } else if (searchData.results && Array.isArray(searchData.results) && searchData.results.length > 0) {
      propertyId = searchData.results[0].propertyId || searchData.results[0].listingId || searchData.results[0].id;
    } else if (searchData.propertyId || searchData.id) {
      propertyId = searchData.propertyId || searchData.id;
    } else if (Array.isArray(searchData) && searchData.length > 0) {
      propertyId = searchData[0].propertyId || searchData[0].listingId || searchData[0].id;
    }

    if (!propertyId) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          estimated: false,
          message: "We couldn't find enough data for that address. Our team will prepare a personalized valuation and reach out to you shortly.",
        }),
      };
    }

    // Step 2: Get property details using the property ID
    const propertyData = await redfinFetch(
      `/redfin/property/${propertyId}`,
      apiKey
    );

    if (!propertyData) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          estimated: false,
          message: "We found the property but couldn't retrieve valuation data. Our team will reach out with a detailed estimate shortly.",
        }),
      };
    }

    // Extract price from property data — try multiple field names
    const price =
      propertyData.estimatedValue ||
      propertyData.price ||
      propertyData.estimateValue ||
      propertyData.avm ||
      propertyData.zestimate ||
      (propertyData.data && (propertyData.data.estimatedValue || propertyData.data.price)) ||
      (propertyData.propertyDetails && propertyData.propertyDetails.estimatedValue) ||
      null;

    const numericPrice = typeof price === "string" ? parseInt(price.replace(/[^0-9]/g, ""), 10) : price;

    if (!numericPrice || isNaN(numericPrice)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          estimated: false,
          message: "We found the property but an automated estimate isn't available. Our team will prepare a Comparative Market Analysis and reach out shortly.",
        }),
      };
    }

    const low = Math.round(numericPrice * 0.93);
    const high = Math.round(numericPrice * 1.07);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        estimated: true,
        price: numericPrice,
        low: low,
        high: high,
        address: address,
      }),
    };
  } catch (err) {
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
