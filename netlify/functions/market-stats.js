// Calculates market snapshot stats for a city from SimplyRETS
// Paginates to get ALL listings for accurate stats
// Results cached in-memory for 4 hours + CDN for 24 hours

const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000;

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

  const cacheKey = city.toLowerCase();
  if (cache[cacheKey] && (Date.now() - cache[cacheKey].ts) < CACHE_TTL) {
    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify(cache[cacheKey].data) };
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const PAGE_SIZE = 500;

  // Fetch all pages for a given price bracket
  async function fetchAllInBracket(minPrice, maxPrice) {
    const allListings = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        q: city, status: "active", type: "residential",
        limit: String(PAGE_SIZE), offset: String(offset),
        minprice: String(minPrice), maxprice: String(maxPrice),
        sort: "listprice",
      });

      const res = await fetch(`https://api.simplyrets.com/properties?${params.toString()}`, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      });

      if (!res.ok) break;

      const data = await res.json();
      allListings.push(...data);

      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        // Safety cap: max 5 pages (2500 listings) per bracket
        if (offset >= 2500) break;
      }
    }

    return allListings;
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

    // Fetch all brackets in parallel — each one paginates internally
    const bracketResults = await Promise.all(
      displayBrackets.map((b) => fetchAllInBracket(b.min, b.max))
    );

    const seen = new Set();
    const allListings = [];
    const distribution = [];

    bracketResults.forEach((listings, i) => {
      // Filter to residential with bedrooms for stats
      const residential = listings.filter(
        (p) => p.property && p.property.bedrooms && p.property.bedrooms > 0
      );

      distribution.push({
        label: displayBrackets[i].label,
        count: residential.length,
        min: displayBrackets[i].min,
        max: displayBrackets[i].max,
      });

      residential.forEach((p) => {
        const id = p.mlsId || p.listingId;
        if (!seen.has(id)) {
          seen.add(id);
          allListings.push(p);
        }
      });
    });

    const totalActive = distribution.reduce((sum, d) => sum + d.count, 0);

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

    cache[cacheKey] = { data: result, ts: Date.now() };
    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify(result) };
  } catch (err) {
    return {
      statusCode: 200, headers: baseHeaders,
      body: JSON.stringify({ city, error: "Failed to calculate stats", detail: err.message }),
    };
  }
};
