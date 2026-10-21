// Calculates market snapshot stats for a city from SimplyRETS
// Fetches across price brackets to get representative data

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

  const city = event.queryStringParameters && event.queryStringParameters.city;
  if (!city) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "City required" }) };
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  async function fetchBracket(minPrice, maxPrice, limit) {
    const params = new URLSearchParams({
      q: city,
      status: "active",
      type: "residential",
      limit: String(limit),
    });
    if (minPrice > 0) params.set("minprice", String(minPrice));
    if (maxPrice < Infinity) params.set("maxprice", String(maxPrice));

    const res = await fetch(`https://api.simplyrets.com/properties?${params.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) return { listings: [], count: 0 };
    const total = parseInt(res.headers.get("X-Total-Count") || "0");
    const data = await res.json();
    return { listings: data, count: total || data.length };
  }

  try {
    // Fetch across price brackets to get representative sample
    const brackets = [
      { label: "Under $300K", min: 0, max: 300000 },
      { label: "$300K - $500K", min: 300000, max: 500000 },
      { label: "$500K - $750K", min: 500000, max: 750000 },
      { label: "$750K - $1M", min: 750000, max: 1000000 },
      { label: "$1M - $2M", min: 1000000, max: 2000000 },
      { label: "$2M+", min: 2000000, max: 99999999 },
    ];

    const results = await Promise.all(
      brackets.map((b) => fetchBracket(b.min, b.max, 100))
    );

    // Merge all listings and deduplicate
    const seen = new Set();
    const allListings = [];
    let totalActive = 0;
    const distribution = [];

    results.forEach((r, i) => {
      distribution.push({ label: brackets[i].label, count: r.count });
      totalActive += r.count;
      r.listings.forEach((p) => {
        const id = p.mlsId || p.listingId;
        if (!seen.has(id) && p.property && p.property.bedrooms && p.property.bedrooms > 0) {
          seen.add(id);
          allListings.push(p);
        }
      });
    });

    if (allListings.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ city, stats: null, message: "No data available" }),
      };
    }

    // Calculate stats
    const prices = allListings.map((p) => p.listPrice).filter((p) => p > 0).sort((a, b) => a - b);
    const sqftPrices = allListings
      .filter((p) => p.property.area && p.property.area > 0)
      .map((p) => p.listPrice / p.property.area);
    const sqfts = allListings.map((p) => p.property.area).filter((s) => s > 0);

    const now = Date.now();
    const doms = allListings
      .map((p) => {
        if (p.mls && p.mls.daysOnMarket && p.mls.daysOnMarket > 0) return p.mls.daysOnMarket;
        if (p.listDate) {
          const listed = new Date(p.listDate).getTime();
          if (listed > 0) return Math.max(0, Math.round((now - listed) / 86400000));
        }
        return null;
      })
      .filter((d) => d !== null && d >= 0);

    function median(arr) {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function avg(arr) {
      if (arr.length === 0) return 0;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    const stats = {
      activeListings: totalActive || allListings.length,
      medianPrice: Math.round(median(prices)),
      avgPricePerSqft: Math.round(avg(sqftPrices)),
      avgDaysOnMarket: doms.length > 0 ? Math.round(avg(doms)) : null,
      sampleSize: allListings.length,
      priceDistribution: distribution,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ city, stats }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ city, error: "Failed to calculate stats", detail: err.message }),
    };
  }
};
