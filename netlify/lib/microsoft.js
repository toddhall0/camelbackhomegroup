// Microsoft Graph helpers for agent mailboxes
//
// Env vars required:
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  (server-side only)

const GRAPH = "https://graph.microsoft.com/v1.0";

const isConfigured = () => !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);

async function getToken() {
  const response = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || "Could not sign in to Microsoft");
  return json.access_token;
}

async function graph(token, path, { method = "GET", body, headers } = {}) {
  const response = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error((json.error && json.error.message) || `Microsoft returned ${response.status}`);
  return json;
}

// A draft first, because sendMail returns nothing we could use to recognise the message later.
// Sending this way also leaves a copy in the agent's Sent Items.
async function sendMail(token, { mailbox, to, subject, body }) {
  const user = encodeURIComponent(mailbox);
  const draft = await graph(token, `/users/${user}/messages`, {
    method: "POST",
    body: {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
  });
  await graph(token, `/users/${user}/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });
  return draft.internetMessageId;
}

async function listInbox(token, mailbox, since) {
  const query = new URLSearchParams({
    $filter: `receivedDateTime ge ${since}`,
    $orderby: "receivedDateTime desc",
    $select: "internetMessageId,subject,from,receivedDateTime,uniqueBody",
    $top: "100",
  });
  const { value } = await graph(token, `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?${query}`, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
  return value;
}

module.exports = { isConfigured, getToken, sendMail, listInbox };
