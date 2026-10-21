// Calculates market snapshot stats for a city from SimplyRETS
// Uses price bracket counts + representative sample for stats

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

  async function fetchListings(params) {
    const res = await fetch(`https://api.simplyrets.com/properties?${params.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) return { listings: [], total: 0 };
    const total = parseInt(res.headers.get("X-Total-Count") || "0");
    const data = await res.json();
    return { listings: data, total };
  }

  try {
    // Display brackets (what users see)
    const displayBrackets = [
      { label: "Under $300K", min: 0, max: 299999 },
      { label: "$300K - $500K", min: 300000, max: 499999 },
      { label: "$500K - $750K", min: 500000, max: 749999 },
      { label: "$750K - $1M", min: 750000, max: 999999 },
      { label: "$1M - $2M", min: 1000000, max: 1999999 },
      { label: "$2M+", min: 2000000, max: 99999999 },
    ];

    // Fetch brackets — split large ranges to avoid 500 cap
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
      fetchBrackets.map((b) => {
        const p = new URLSearchParams({
          q: city, status: "active", type: "residential",
          limit: "500", minprice: String(b.min), maxprice: String(b.max),
        });
        return fetchListings(p);
      })
    );

    // Merge into display brackets
    const bracketCounts = {};
    displayBrackets.forEach((d) => { bracketCounts[d.label] = 0; });

    const seen = new Set();
    const allListings = [];

    results.forEach((r, i) => {
      const fb = fetchBrackets[i];
      // Find which display bracket this fetch bracket belongs to
      const db = displayBrackets.find((d) => fb.min >= d.min && fb.max <= d.max);
      if (db) {
        const count = r.total > 0 ? r.total : r.listings.length;
        bracketCounts[db.label] += count;
      }

      r.listings.forEach((p) => {
        const id = p.mlsId || p.listingId;
        if (!seen.has(id) && p.property && p.property.bedrooms && p.property.bedrooms > 0) {
          seen.add(id);
          allListings.push(p);
        }
      });
    });

    const distribution = displayBrackets.map((d) => ({
      label: d.label,
      count: bracketCounts[d.label],
    }));

    let totalActive = distribution.reduce((sum, d) => sum + d.count, 0);

    if (allListings.length === 0) {
      return {
        statusCode: 200,
        headers,
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

    const stats = {
      activeListings: totalActive,
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
