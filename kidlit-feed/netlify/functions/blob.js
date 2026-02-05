// netlify/functions/blob.js
// Proxy for com.atproto.repo.getBlob
// Returns raw blob bytes from Bluesky with correct Content-Type.

let cachedJwt = null;
let cachedJwtExp = 0;

async function getJwt() {
  const now = Date.now();
  if (cachedJwt && now < cachedJwtExp - 60_000) return cachedJwt;

  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!identifier || !password) {
    throw new Error("Missing BLUESKY_IDENTIFIER or BLUESKY_APP_PASSWORD env vars");
  }

  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`createSession failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  cachedJwt = data.accessJwt;
  cachedJwtExp = now + 25 * 60_000; // cache ~25 minutes
  return cachedJwt;
}

const parseQuery = (qs, key) => {
  if (!qs) return null;
  return qs[key] || null;
};

exports.handler = async (event) => {
  try {
    const did = parseQuery(event.queryStringParameters, "did");
    const cid = parseQuery(event.queryStringParameters, "cid");
    if (!did || !cid) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Missing 'did' or 'cid' query parameter" }),
      };
    }

    const jwt = await getJwt();

    // Call the repo.getBlob endpoint (returns binary)
    const url = "https://bsky.social/xrpc/com.atproto.repo.getBlob";
    const body = JSON.stringify({ repo: did, cid: cid });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        statusCode: res.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: `repo.getBlob failed: ${res.status} ${txt}` }),
      };
    }

    // stream the blob back with proper content-type
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400", // cache image for a day
      },
      body: base64,
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: String(err?.message || err) }),
    };
  }
};
