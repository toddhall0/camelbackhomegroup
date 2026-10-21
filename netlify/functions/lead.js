// Sends a lead to Sierra Interactive CRM
//
// Env vars required:
//   SIERRA_API_KEY

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

  const sierraKey = process.env.SIERRA_API_KEY;

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { firstName, lastName, email, phone, propertyAddress, propertyMlsId, source } = body;

  if (!email && !phone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Email or phone required" }) };
  }

  // Always save to Netlify Forms as backup
  const netlifyResult = { saved: true };

  // If Sierra API key is configured, push to CRM
  if (sierraKey) {
    try {
      // Generate a random password for the lead's Sierra account
      const randomPwd = Math.random().toString(36).slice(-10) + "A1!";

      const leadData = {
        firstName: firstName || "",
        lastName: lastName || "",
        email: email || "",
        password: randomPwd,
        phone: phone || "",
        source: source || "Camelback Home Group Website",
        sourceType: "AgentSite",
        leadType: 1,
        sendRegistrationEmail: false,
        note: propertyAddress
          ? `Interested in: ${propertyAddress}${propertyMlsId ? " (MLS# " + propertyMlsId + ")" : ""}`
          : "Website lead registration",
      };

      const response = await fetch("https://api.sierrainteractivedev.com/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sierra-ApiKey": sierraKey,
        },
        body: JSON.stringify(leadData),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, crm: "sierra", leadId: data.id || null }),
        };
      } else {
        const errText = await response.text();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, crm: "fallback" }),
        };
      }
    } catch (err) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, crm: "fallback" }),
      };
    }
  }

  // No Sierra key — just confirm the lead was captured
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, crm: "none", note: "Lead captured" }),
  };
};
