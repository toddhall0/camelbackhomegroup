// Calculates market snapshot stats for a city from SimplyRETS
// Fetches from both price ends to get accurate stats across the full range

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

  async function fetchPage(sort, limit) {
    const params = new URLSearchParams({
      q: city,
      status: "active",
      type: "residential",
      limit: String(limit),
      sort: sort,
    });
    const res = await fetch(`https://api.simplyrets.com/properties?${params.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) return { listings: [], total: 0 };
    const total = parseInt(res.headers.get("X-Total-Count") || "0");
    const data = await res.json();
    return { listings: data, total };
  }

  try {
    // Fetch from BOTH ends to get full price range
    const [lowEnd, highEnd] = await Promise.all([
      fetchPage("listprice", 250),   // cheapest 250
      fetchPage("-listprice", 250),   // most expensive 250
    ]);

    const totalActive = Math.max(lowEnd.total, highEnd.total) || allListings.length;

    // Merge and deduplicate
    const seen = new Set();
    const allListings = [];
    [...lowEnd.listings, ...highEnd.listings].forEach((p) => {
      const id = p.mlsId || p.listingId;
      if (!seen.has(id) && p.property && p.property.bedrooms && p.property.bedrooms > 0) {
        seen.add(id);
        allListings.push(p);
      }
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

    // Calculate DOM from listDate if daysOnMarket is 0/null
    const now = Date.now();
    const doms = allListings
      .map((p) => {
        if (p.mls && p.mls.daysOnMarket && p.mls.daysOnMarket > 0) {
          return p.mls.daysOnMarket;
        }
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
      avgPrice: Math.round(avg(prices)),
      minPrice: prices[0] || 0,
      maxPrice: prices[prices.length - 1] || 0,
      avgPricePerSqft: Math.round(avg(sqftPrices)),
      medianSqft: Math.round(median(sqfts)),
      avgDaysOnMarket: doms.length > 0 ? Math.round(avg(doms)) : null,
      medianDaysOnMarket: doms.length > 0 ? Math.round(median(doms)) : null,
      sampleSize: allListings.length,
    };

    // Price distribution
    const ranges = [
      { label: "Under $300K", min: 0, max: 300000 },
      { label: "$300K - $500K", min: 300000, max: 500000 },
      { label: "$500K - $750K", min: 500000, max: 750000 },
      { label: "$750K - $1M", min: 750000, max: 1000000 },
      { label: "$1M - $2M", min: 1000000, max: 2000000 },
      { label: "$2M+", min: 2000000, max: Infinity },
    ];

    stats.priceDistribution = ranges.map((r) => ({
      label: r.label,
      count: prices.filter((p) => p >= r.min && p < r.max).length,
      // Estimate count for the full dataset if we only have a sample
      estimated: totalActive > allListings.length
        ? Math.round((prices.filter((p) => p >= r.min && p < r.max).length / allListings.length) * totalActive)
        : prices.filter((p) => p >= r.min && p < r.max).length,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ city, stats }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ city, error: "Failed to calculate stats" }),
    };
  }
};
