// Electrical Assistant AI server (Cloudflare Worker).
// Holds the Anthropic API key as a secret and only answers signed-in,
// email-verified members of the Electrical Unit team.
//
// Secrets / variables to set in Cloudflare (Settings > Variables and Secrets):
//   ANTHROPIC_API_KEY  (secret)  your key from console.anthropic.com
// Optional variables:
//   ALLOWED_ORIGIN     default https://ainebel.github.io
//   OWNER_EMAIL        default farah12@un.org

const PROJECT_ID = "electrical-unit";
const MODELS = ["claude-sonnet-5-5"];
const MAX_TOKENS = 8000;
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwksCache = { keys: null, until: 0 };

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://ainebel.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function fail(env, status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json", ...cors(env) },
  });
}

function b64urlBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function googleKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  const body = await res.json();
  const maxAge = Number((res.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys: body.keys, until: Date.now() + maxAge * 1000 };
  return body.keys;
}

// Verifies a Firebase ID token and returns its claims, or null.
async function verifyIdToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  if (header.alg !== "RS256") return null;
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]),
  );
  const now = Math.floor(Date.now() / 1000);
  if (!ok) return null;
  if (claims.aud !== PROJECT_ID || claims.iss !== "https://securetoken.google.com/" + PROJECT_ID) return null;
  if (!(claims.exp > now) || !(claims.iat <= now + 60) || !claims.sub) return null;
  if (!claims.email || claims.email_verified !== true) return null;
  return claims;
}

// A team member has a document team/<email> in Firestore. The read uses the
// caller's own token, so the existing Firestore rules decide.
async function isMember(token, email) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/team/${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { authorization: "Bearer " + token } });
  return res.ok;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    if (request.method !== "POST") return fail(env, 405, "Use POST.");
    if (!env.ANTHROPIC_API_KEY) return fail(env, 500, "The AI server has no ANTHROPIC_API_KEY secret yet.");

    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const claims = token && (await verifyIdToken(token).catch(() => null));
    if (!claims) return fail(env, 401, "Sign in again to use the AI features.");
    const email = claims.email.toLowerCase();
    const owner = (env.OWNER_EMAIL || "farah12@un.org").toLowerCase();
    if (email !== owner && !(await isMember(token, email))) {
      return fail(env, 403, "Your account is not on the Electrical Unit team yet. Ask the supervisor to add you.");
    }

    let body;
    try { body = await request.json(); } catch { return fail(env, 400, "Bad request."); }
    if (!Array.isArray(body.messages) || !body.messages.length) return fail(env, 400, "No messages.");

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.includes(body.model) ? body.model : MODELS[0],
        max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS),
        stream: body.stream !== false,
        messages: body.messages,
        metadata: { user_id: claims.sub },
      }),
    });

    const headers = new Headers(cors(env));
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
