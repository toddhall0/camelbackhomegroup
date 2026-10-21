// Calculates market snapshot stats for a city from SimplyRETS
//
// Returns: median price, avg price/sqft, active count, avg DOM, price range

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

  async function fetchListings(status, limit) {
    const params = new URLSearchParams({
      q: city,
      status: status,
      type: "residential",
      limit: String(limit),
      sort: "-listprice",
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
    // Fetch active listings (up to 500 for stats)
    const active = await fetchListings("active", 500);

    // Filter to residential with bedrooms
    const homes = active.listings.filter(
      (p) => p.property && p.property.bedrooms && p.property.bedrooms > 0
    );

    if (homes.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ city, stats: null, message: "No data available" }),
      };
    }

    // Calculate stats
    const prices = homes.map((p) => p.listPrice).filter((p) => p > 0).sort((a, b) => a - b);
    const sqftPrices = homes
      .filter((p) => p.property.area && p.property.area > 0)
      .map((p) => p.listPrice / p.property.area);
    const doms = homes
      .filter((p) => p.mls && p.mls.daysOnMarket !== undefined && p.mls.daysOnMarket !== null)
      .map((p) => p.mls.daysOnMarket);
    const beds = homes.map((p) => p.property.bedrooms).filter((b) => b > 0);
    const sqfts = homes.map((p) => p.property.area).filter((s) => s > 0);

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
      activeListings: active.total || homes.length,
      medianPrice: Math.round(median(prices)),
      avgPrice: Math.round(avg(prices)),
      minPrice: prices[0] || 0,
      maxPrice: prices[prices.length - 1] || 0,
      avgPricePerSqft: Math.round(avg(sqftPrices)),
      medianSqft: Math.round(median(sqfts)),
      avgBeds: parseFloat(avg(beds).toFixed(1)),
      avgDaysOnMarket: Math.round(avg(doms)),
      medianDaysOnMarket: Math.round(median(doms)),
      sampleSize: homes.length,
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
