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

  if (!res.ok) throw new Error(`createSession failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  cachedJwt = data.accessJwt;
  cachedJwtExp = now + 25 * 60_000; // cache ~25 minutes
  return cachedJwt;
}

exports.handler = async (event) => {
  try {
    const tag = (event.queryStringParameters?.tag || "kidlitartpostcard").replace(/^#/, "");
    const sort = event.queryStringParameters?.sort || "top";
    const limit = event.queryStringParameters?.limit || "25";
    const cursor = event.queryStringParameters?.cursor;

    const jwt = await getJwt();

    const url = new URL("https://bsky.social/xrpc/app.bsky.feed.searchPosts");
    url.searchParams.set("q", tag);
    url.searchParams.set("tag", tag);
    url.searchParams.set("sort", sort);
    url.searchParams.set("limit", limit);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${jwt}` } });

    return {
      statusCode: res.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30",
      },
      body: await res.text(),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: String(err?.message || err) }),
    };
  }
};
