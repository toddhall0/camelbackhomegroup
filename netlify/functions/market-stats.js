// Calculates market snapshot stats for a city from SimplyRETS
// Results cached in-memory for 4 hours and via CDN for 24 hours

const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

exports.handler = async (event) => {
  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: baseHeaders, body: "" };
  }

  const apiKey = process.env.SIMPLYRETS_API_KEY;
  const apiSecret = process.env.SIMPLYRETS_API_SECRET;

  if (!apiKey || !apiSecret) {
    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify({ error: "API not configured" }) };
  }

  const city = event.queryStringParameters && event.queryStringParameters.city;
  if (!city) {
    return { statusCode: 400, headers: baseHeaders, body: JSON.stringify({ error: "City required" }) };
  }

  // Check in-memory cache
  const cacheKey = city.toLowerCase();
  if (cache[cacheKey] && (Date.now() - cache[cacheKey].ts) < CACHE_TTL) {
    return {
      statusCode: 200,
      headers: baseHeaders,
      body: JSON.stringify(cache[cacheKey].data),
    };
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  async function fetchBracket(minPrice, maxPrice) {
    const params = new URLSearchParams({
      q: city, status: "active", type: "residential",
      limit: "500", minprice: String(minPrice), maxprice: String(maxPrice),
    });
    const res = await fetch(`https://api.simplyrets.com/properties?${params.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) return { listings: [], count: 0 };
    const total = parseInt(res.headers.get("X-Total-Count") || "0");
    const data = await res.json();
    return { listings: data, count: total || data.length };
  }

  try {
    const displayBrackets = [
      { label: "Under $300K", min: 0, max: 299999 },
      { label: "$300K - $500K", min: 300000, max: 499999 },
      { label: "$500K - $750K", min: 500000, max: 749999 },
      { label: "$750K - $1M", min: 750000, max: 999999 },
      { label: "$1M - $2M", min: 1000000, max: 1999999 },
      { label: "$2M+", min: 2000000, max: 99999999 },
    ];

    const fetchBrackets = [
      { min: 0, max: 299999 },
      { min: 300000, max: 499999 },
      { min: 500000, max: 749999 },
      { min: 750000, max: 999999 },
      { min: 1000000, max: 1499999 },
      { min: 1500000, max: 1999999 },
      { min: 2000000, max: 3499999 },
      { min: 3500000, max: 5999999 },
      { min: 6000000, max: 99999999 },
    ];

    const results = await Promise.all(
      fetchBrackets.map((b) => fetchBracket(b.min, b.max))
    );

    const bracketCounts = {};
    displayBrackets.forEach((d) => { bracketCounts[d.label] = 0; });

    const seen = new Set();
    const allListings = [];

    results.forEach((r, i) => {
      const fb = fetchBrackets[i];
      const db = displayBrackets.find((d) => fb.min >= d.min && fb.max <= d.max);
      if (db) bracketCounts[db.label] += r.count;

      r.listings.forEach((p) => {
        const id = p.mlsId || p.listingId;
        if (!seen.has(id) && p.property && p.property.bedrooms && p.property.bedrooms > 0) {
          seen.add(id);
          allListings.push(p);
        }
      });
    });

    const distribution = displayBrackets.map((d) => ({
      label: d.label, count: bracketCounts[d.label], min: d.min, max: d.max,
    }));

    let totalActive = distribution.reduce((sum, d) => sum + d.count, 0);

    if (allListings.length === 0) {
      return {
        statusCode: 200, headers: baseHeaders,
        body: JSON.stringify({ city, stats: null, message: "No data available" }),
      };
    }

    const prices = allListings.map((p) => p.listPrice).filter((p) => p > 0).sort((a, b) => a - b);
    const sqftPrices = allListings
      .filter((p) => p.property.area && p.property.area > 0)
      .map((p) => p.listPrice / p.property.area);

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

    const result = {
      city,
      stats: {
        activeListings: totalActive,
        medianPrice: Math.round(median(prices)),
        avgPricePerSqft: Math.round(avg(sqftPrices)),
        avgDaysOnMarket: doms.length > 0 ? Math.round(avg(doms)) : null,
        sampleSize: allListings.length,
        priceDistribution: distribution,
      },
      cachedAt: new Date().toISOString(),
    };

    // Store in memory cache
    cache[cacheKey] = { data: result, ts: Date.now() };

    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify(result) };
  } catch (err) {
    return {
      statusCode: 200, headers: baseHeaders,
      body: JSON.stringify({ city, error: "Failed to calculate stats", detail: err.message }),
    };
  }
};
