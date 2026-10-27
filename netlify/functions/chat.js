// AI Chat — "Kathy" powered by Claude
// Env vars: ANTHROPIC_API_KEY, SIMPLYRETS_API_KEY, SIMPLYRETS_API_SECRET

const SYSTEM_PROMPT = `You are Kathy, a friendly and knowledgeable real estate assistant for Camelback Home Group (CHG), a Phoenix-area real estate brokerage. You're warm, approachable, and genuinely helpful.

ABOUT CAMELBACK HOME GROUP:
- Phoenix's only brokerage with licensed real estate attorneys and paralegals overseeing every transaction at no additional cost
- Serves the entire Phoenix metro area (Scottsdale, Mesa, Chandler, Gilbert, Tempe, Glendale, Peoria, Surprise, Goodyear, Buckeye, Queen Creek, Maricopa, Casa Grande, Apache Junction, Fountain Hills)
- Phone: (480) 203-3039
- Website: camelbackhomegroup.com

YOUR GOALS (in order of priority):
1. Be genuinely helpful — answer questions about Phoenix real estate, neighborhoods, market conditions, the home buying/selling process
2. Nurture the lead — build rapport, understand what they're looking for
3. Capture their contact info naturally — ask for their name, email, and phone when appropriate (not immediately — wait until you've provided value first)
4. Connect them with an agent — when they're ready for a showing, have specific questions about a property, or want to discuss their situation in detail, suggest they speak with one of our agents

PERSONALITY:
- Warm and conversational, not salesy or pushy
- Knowledgeable but not condescending
- Use short, friendly responses (2-4 sentences typically)
- Occasionally use light humor
- Address people by their first name once you know it

LEAD CAPTURE APPROACH:
- Don't ask for contact info right away — provide value first
- After 2-3 helpful exchanges, naturally offer to send them listings or updates (which requires their email)
- If they ask about a specific property or want to schedule a showing, that's the perfect time to get their info
- When you have their info, let them know you'll have an agent reach out

WHEN SEARCHING LISTINGS:
- When someone describes what they're looking for (city, price range, bedrooms, etc.), use the search_listings tool to find matching properties
- Present results conversationally — highlight 2-3 top picks with key details
- Include the property page link so they can see photos and details
- Use this as an opportunity to offer more personalized help

WHAT YOU KNOW:
- General Phoenix real estate market knowledge
- Neighborhood characteristics (Scottsdale = luxury/upscale, Gilbert = family-friendly, Tempe = young professionals/ASU, Mesa = affordable/diverse, etc.)
- The home buying and selling process
- CHG's legal advantage and how it protects clients
- You do NOT know specific current market stats — if asked for precise numbers, suggest they check with an agent

BOUNDARIES:
- Don't make up specific market data or statistics
- Don't provide legal or financial advice — suggest they consult with the team's attorneys
- Don't guarantee anything about specific properties
- If asked about something outside real estate, gently redirect
- Keep responses concise — this is a chat, not an essay`;

const TOOLS = [
  {
    name: "search_listings",
    description: "Search for real estate listings in the Phoenix metro area. Use this when someone describes what they're looking for.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name (e.g. Scottsdale, Gilbert, Mesa)" },
        minPrice: { type: "number", description: "Minimum price" },
        maxPrice: { type: "number", description: "Maximum price" },
        minBeds: { type: "number", description: "Minimum bedrooms" },
        minBaths: { type: "number", description: "Minimum bathrooms" },
        limit: { type: "number", description: "Max results (default 5)" }
      }
    }
  },
  {
    name: "capture_lead",
    description: "Save lead contact information to the CRM when the user provides their name, email, or phone. Call this as soon as you have at least an email.",
    input_schema: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        notes: { type: "string", description: "Summary of what the lead is looking for" }
      },
      required: ["email"]
    }
  }
];

async function searchListings(params) {
  const apiKey = process.env.SIMPLYRETS_API_KEY;
  const apiSecret = process.env.SIMPLYRETS_API_SECRET;
  if (!apiKey || !apiSecret) return { error: "Listing search not configured" };

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const query = new URLSearchParams();
  if (params.city) query.set("q", params.city);
  if (params.minPrice) query.set("minprice", params.minPrice);
  if (params.maxPrice) query.set("maxprice", params.maxPrice);
  if (params.minBeds) query.set("minbeds", params.minBeds);
  if (params.minBaths) query.set("minbaths", params.minBaths);
  query.set("limit", params.limit || 5);
  query.set("status", "active");
  query.set("sort", "-listprice");

  const resp = await fetch(`https://api.simplyrets.com/properties?${query}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }
  });

  if (!resp.ok) return { error: "Search failed" };
  const data = await resp.json();

  return data
    .filter(p => p.property && p.property.bedrooms > 0)
    .slice(0, params.limit || 5)
    .map(p => ({
      mlsNumber: p.listingId || "",
      id: p.mlsId,
      price: p.listPrice,
      address: p.address ? `${p.address.streetNumberText || ""} ${p.address.streetName || ""} ${p.address.streetSuffix || ""}`.trim() : "",
      city: p.address ? p.address.city : "",
      beds: p.property ? p.property.bedrooms : null,
      baths: p.property ? p.property.bathsFull : null,
      sqft: p.property ? p.property.area : null,
      yearBuilt: p.property ? p.property.yearBuilt : null,
      photo: p.photos && p.photos[0] ? p.photos[0] : null,
      link: `/property.html?id=${p.mlsId}`
    }));
}

async function captureLead(params) {
  const sierraKey = process.env.SIERRA_API_KEY;
  if (!sierraKey) return { saved: false };

  const randomPwd = Math.random().toString(36).slice(-10) + "A1!";
  const leadData = {
    firstName: params.firstName || "",
    lastName: params.lastName || "",
    email: params.email,
    password: randomPwd,
    phone: params.phone || "",
    source: "Kathy AI Chat",
    sourceType: "AgentSite",
    leadType: 1,
    sendRegistrationEmail: false,
    note: params.notes || "Lead from AI chat assistant",
  };

  try {
    const resp = await fetch("https://api.sierrainteractivedev.com/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sierra-ApiKey": sierraKey },
      body: JSON.stringify(leadData),
    });
    const txt = await resp.text();
    return { saved: resp.ok, detail: txt };
  } catch {
    return { saved: false };
  }
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Chat not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { messages = [], pageContext = "" } = body;
  const systemWithContext = SYSTEM_PROMPT + (pageContext ? `\n\nThe user is currently viewing: ${pageContext}` : "");

  try {
    let claudeMessages = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    let response;
    let maxToolRounds = 3;

    for (let round = 0; round < maxToolRounds; round++) {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          max_tokens: 1024,
          system: systemWithContext,
          messages: claudeMessages,
          tools: TOOLS,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { statusCode: 200, headers, body: JSON.stringify({ error: "AI service error", detail: errText }) };
      }

      const result = await response.json();

      if (result.stop_reason === "tool_use") {
        const toolBlocks = result.content.filter(b => b.type === "tool_use");
        const toolResults = [];

        for (const tool of toolBlocks) {
          let toolResult;
          if (tool.name === "search_listings") {
            toolResult = await searchListings(tool.input);
          } else if (tool.name === "capture_lead") {
            toolResult = await captureLead(tool.input);
          } else {
            toolResult = { error: "Unknown tool" };
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: JSON.stringify(toolResult),
          });
        }

        claudeMessages.push({ role: "assistant", content: result.content });
        claudeMessages.push({ role: "user", content: toolResults });
      } else {
        const textBlock = result.content.find(b => b.type === "text");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            reply: textBlock ? textBlock.text : "I'm sorry, I didn't catch that. Could you try again?",
          }),
        };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: "Let me look into that for you. Could you give me a moment?" }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: "Chat error", detail: err.message }),
    };
  }
};
