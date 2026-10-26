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
    // --- GET lead data (for debugging) ---
    if (action === "getLead") {
      const { email } = body;
      if (!email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email required" }) };
      }
      const resp = await fetch(`${SIERRA_BASE}/leads/get/${encodeURIComponent(email)}`, {
        method: "GET",
        headers: sierraHeaders,
      });
      const txt = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: txt,
      };
    }

    // --- RECORD PROPERTY VIEW in lead's Data section ---
    if (action === "propertyView") {
      const { email, mlsNumber, partnerLink } = body;
      if (!email || !mlsNumber) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and mlsNumber required for propertyView" }) };
      }
      const viewData = { email, mlsNumber };
      if (partnerLink) viewData.partnerLink = partnerLink;
      const resp = await fetch(`${SIERRA_BASE}/listings/propertyView/`, {
        method: "POST",
        headers: sierraHeaders,
        body: JSON.stringify(viewData),
      });
      const txt = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: resp.ok, crm: "sierra", action: "propertyView", status: resp.status, detail: txt }),
      };
    }

    // --- RECORD SITE VISIT in lead's Data section ---
    if (action === "siteVisit") {
      const { email, url: visitUrl } = body;
      if (!email || !visitUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and url required for siteVisit" }) };
      }
      const resp = await fetch(`${SIERRA_BASE}/leads/${encodeURIComponent(email)}/siteVisit`, {
        method: "POST",
        headers: sierraHeaders,
        body: JSON.stringify({
          url: visitUrl,
          visitDateTime: new Date().toISOString(),
        }),
      });
      const txt = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: resp.ok, crm: "sierra", action: "siteVisit", status: resp.status, detail: txt }),
      };
    }

    // --- SAVE LISTING as favorite ---
    if (action === "saveListing") {
      const { email, mlsNumber } = body;
      if (!email || !mlsNumber) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and mlsNumber required" }) };
      }
      const resp = await fetch(`${SIERRA_BASE}/savedListings`, {
        method: "POST",
        headers: sierraHeaders,
        body: JSON.stringify({ leadIdOrEmail: email, mlsNumber }),
      });
      const txt = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: resp.ok, crm: "sierra", action: "saveListing", status: resp.status, detail: txt }),
      };
    }

    // --- REMOVE SAVED LISTING ---
    if (action === "removeListing") {
      const { email, mlsNumber } = body;
      if (!email || !mlsNumber) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and mlsNumber required" }) };
      }
      const resp = await fetch(`${SIERRA_BASE}/savedListings/${encodeURIComponent(email)}/ARMLS/${encodeURIComponent(mlsNumber)}`, {
        method: "DELETE",
        headers: sierraHeaders,
      });
      const txt = await resp.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: resp.ok, crm: "sierra", action: "removeListing", status: resp.status, detail: txt }),
      };
    }

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
      const { email, firstName, lastName, phone, note, source, tags, shortSummary, minPrice, maxPrice } = body;
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
      if (shortSummary) updateData.shortSummary = shortSummary;
      if (minPrice || maxPrice) {
        updateData.searchPreference = {};
        if (minPrice) updateData.searchPreference.minPrice = minPrice;
        if (maxPrice) updateData.searchPreference.maxPrice = maxPrice;
      }

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
