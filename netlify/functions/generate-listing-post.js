// Generates an AI-written listing blog post for SEO
// Called by a scheduled task — picks a listing, writes content with Claude, returns the post data
//
// Env vars: SIMPLYRETS_API_KEY, SIMPLYRETS_API_SECRET, ANTHROPIC_API_KEY

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const srKey = process.env.SIMPLYRETS_API_KEY;
  const srSecret = process.env.SIMPLYRETS_API_SECRET;
  const aiKey = process.env.ANTHROPIC_API_KEY;

  if (!srKey || !srSecret || !aiKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Not configured" }) };
  }

  try {
    // Pick a city to feature (rotate through them)
    const cities = [
      "Scottsdale", "Mesa", "Chandler", "Gilbert", "Tempe",
      "Glendale", "Peoria", "Surprise", "Goodyear", "Buckeye",
      "Queen Creek", "Maricopa", "Fountain Hills", "Phoenix", "Cave Creek"
    ];
    const today = new Date();
    const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    const city = cities[dayOfYear % cities.length];

    // Fetch a recent listing from that city
    const auth = Buffer.from(`${srKey}:${srSecret}`).toString("base64");
    const query = new URLSearchParams({
      q: city,
      limit: "20",
      status: "active",
      sort: "-listdate",
      minprice: "300000",
    });

    const srResp = await fetch(`https://api.simplyrets.com/properties?${query}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });

    if (!srResp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: "SimplyRETS fetch failed" }) };
    }

    const listings = await srResp.json();

    // Filter to good candidates (has photos, beds > 0, has description)
    const candidates = listings.filter(
      (p) => p.photos && p.photos.length >= 3 && p.property && p.property.bedrooms > 0 && p.remarks
    );

    if (!candidates.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: "No suitable listings found for " + city }) };
    }

    // Pick one (use day of year to be deterministic but different each day)
    const listing = candidates[dayOfYear % candidates.length];

    const addr = listing.address || {};
    const prop = listing.property || {};
    const fullAddress = `${addr.streetNumberText || ""} ${addr.streetName || ""} ${addr.streetSuffix || ""}`.trim();
    const cityName = addr.city || city;
    const state = addr.state || "AZ";
    const zip = addr.postalCode || "";
    const slug = `${fullAddress}-${cityName}-${state}-${zip}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Build context for Claude
    const listingContext = {
      address: fullAddress,
      city: cityName,
      state: state,
      zip: zip,
      price: listing.listPrice,
      beds: prop.bedrooms,
      baths: prop.bathsFull,
      halfBaths: prop.bathsHalf,
      sqft: prop.area,
      lotSize: prop.lotSize ? (prop.lotSize / 43560).toFixed(2) + " acres" : null,
      yearBuilt: prop.yearBuilt,
      stories: prop.stories,
      garageSpaces: prop.garageSpaces,
      pool: prop.pool,
      subdivision: prop.subdivision,
      propertyType: prop.subType,
      style: prop.style,
      description: listing.remarks,
      status: listing.mls ? listing.mls.status : "Active",
      daysOnMarket: listing.mls ? listing.mls.daysOnMarket : null,
      listDate: listing.listDate,
      mlsNumber: listing.listingId || "",
      photoCount: listing.photos ? listing.photos.length : 0,
    };

    // Generate AI content
    const aiPrompt = `Write an SEO-optimized blog post about this specific property listing for sale in the Phoenix metro area. The post should read like a detailed, engaging property spotlight that someone searching for this exact address would find helpful.

PROPERTY DETAILS:
${JSON.stringify(listingContext, null, 2)}

INSTRUCTIONS:
- Title should be the full address: "${fullAddress}, ${cityName}, ${state} ${zip}"
- Write 600-900 words of rich, original content
- Start with an engaging overview paragraph about the property
- Include a section about the home's features and layout based on the MLS description
- Include a section about the neighborhood/city (${cityName}) — what makes it a great place to live
- Include a section about the local market context (is this a good value, what similar homes cost, etc.)
- Mention Camelback Home Group naturally — that we provide attorney and paralegal oversight on every transaction at no additional cost
- End with a call to action to schedule a showing or contact our team
- Use HTML formatting: <h2> for section headings, <p> for paragraphs, <ul>/<li> for lists, <strong> for emphasis
- Do NOT include the property details table — that will be added separately
- Do NOT include the title/address in the content — that's in the hero section
- Write naturally, avoid keyword stuffing, but naturally include the full address and city name a few times for SEO
- Include a one-sentence meta description (plain text, no HTML) optimized for someone searching this address

Return ONLY valid JSON in this exact format:
{
  "content": "<h2>...</h2><p>...</p>...",
  "excerpt": "A 2-3 sentence summary for preview cards",
  "metaDescription": "One sentence meta description for search engines"
}`;

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: aiPrompt }],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ error: "AI generation failed", detail: errText }) };
    }

    const aiResult = await aiResp.json();
    const textBlock = aiResult.content.find((b) => b.type === "text");
    if (!textBlock) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: "No AI response" }) };
    }

    // Parse the AI JSON response
    let generated;
    try {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      generated = JSON.parse(jsonMatch[0]);
    } catch {
      return { statusCode: 200, headers, body: JSON.stringify({ error: "Failed to parse AI response", raw: textBlock.text }) };
    }

    // Build the post object
    const post = {
      slug: slug,
      title: `${fullAddress}, ${cityName}, ${state} ${zip}`,
      address: fullAddress,
      city: cityName,
      state: state,
      zip: zip,
      date: today.toISOString().split("T")[0],
      price: listing.listPrice,
      beds: prop.bedrooms,
      baths: prop.bathsFull,
      halfBaths: prop.bathsHalf,
      sqft: prop.area,
      lotSize: prop.lotSize ? (prop.lotSize / 43560).toFixed(2) + " acres" : null,
      yearBuilt: prop.yearBuilt,
      garage: prop.garageSpaces ? prop.garageSpaces + " spaces" : null,
      pool: prop.pool ? "Yes" : null,
      subdivision: prop.subdivision,
      propertyType: prop.subType,
      status: listing.mls ? listing.mls.status : "Active",
      daysOnMarket: listing.mls ? listing.mls.daysOnMarket : null,
      mlsNumber: listing.listingId || "",
      propertyId: listing.mlsId,
      image: listing.photos && listing.photos[0] ? listing.photos[0] : null,
      excerpt: generated.excerpt,
      metaDescription: generated.metaDescription,
      content: generated.content,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, post }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: "Generation error", detail: err.message }),
    };
  }
};
