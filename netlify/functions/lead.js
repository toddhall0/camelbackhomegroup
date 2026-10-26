// Sierra Interactive CRM integration
//
// Env vars required:
//   SIERRA_API_KEY
//
// Actions:
//   create  — POST /leads (default, for new lead registration)
//   update  — PUT  /leads/{email} (update existing lead fields)
//   addNote — POST /leads/{email}/note (add to lead's notes timeline)

const SIERRA_BASE = "https://api.sierrainteractivedev.com";

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

  const { action = "create" } = body;

  if (!sierraKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, crm: "none" }) };
  }

  const sierraHeaders = {
    "Content-Type": "application/json",
    "Sierra-ApiKey": sierraKey,
  };

  try {
    // --- ADD NOTE to existing lead's timeline ---
    if (action === "addNote") {
      const { email, message } = body;
      if (!email || !message) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and message required for addNote" }) };
      }
      const resp = await fetch(`${SIERRA_BASE}/leads/${encodeURIComponent(email)}/note`, {
        method: "POST",
        headers: sierraHeaders,
        body: JSON.stringify({ message, shouldNotify: false }),
      });
      const txt = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: resp.ok, crm: "sierra", action: "addNote", detail: txt }),
      };
    }

    // --- UPDATE existing lead ---
    if (action === "update") {
      const { email, firstName, lastName, phone, note, source, tags } = body;
      if (!email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email required for update" }) };
      }
      const updateData = {};
      if (firstName) updateData.firstName = firstName;
      if (lastName) updateData.lastName = lastName;
      if (phone) updateData.phone = phone;
      if (note) updateData.note = note;
      if (source) updateData.source = source;
      if (tags) updateData.tags = tags;

      const resp = await fetch(`${SIERRA_BASE}/leads/${encodeURIComponent(email)}`, {
        method: "PUT",
        headers: sierraHeaders,
        body: JSON.stringify(updateData),
      });
      const txt = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: resp.ok, crm: "sierra", action: "update", detail: txt }),
      };
    }

    // --- CREATE new lead (default) ---
    const { firstName, lastName, email, phone, propertyAddress, propertyMlsId, source, note } = body;

    if (!email && !phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email or phone required" }) };
    }

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
      note: note
        ? note
        : propertyAddress
          ? `Interested in: ${propertyAddress}${propertyMlsId ? " (MLS# " + propertyMlsId + ")" : ""}`
          : "Website lead registration",
    };

    const resp = await fetch(`${SIERRA_BASE}/leads`, {
      method: "POST",
      headers: sierraHeaders,
      body: JSON.stringify(leadData),
    });

    if (resp.ok) {
      const data = await resp.json();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, crm: "sierra", action: "create", leadId: data.data?.leadId || data.id || null }),
      };
    } else {
      const errText = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, crm: "fallback", detail: errText }),
      };
    }
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, crm: "fallback", error: err.message }),
    };
  }
};
