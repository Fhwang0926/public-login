const crypto = require("crypto");

function trimSlash(url) {
  return String(url || "").replace(/\/$/, "");
}

function isPlaceholderCredential(value) {
  const v = String(value || "").trim().toLowerCase();
  return !v || v === "your_client_id" || v === "your_client_secret";
}

function getBioPassConfig() {
  const port = Number(process.env.PORT) || 5000;
  const apiBase = trimSlash(
    process.env.BIO_PASS_API || "http://127.0.0.1:3030/api"
  );
  const clientId = String(process.env.BIO_PASS_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.BIO_PASS_CLIENT_SECRET || "").trim();
  const redirectUri =
    String(process.env.BIO_PASS_REDIRECT_URI || "").trim() ||
    `http://127.0.0.1:${port}/auth/callback`;
  const scope = String(process.env.BIO_PASS_SCOPE || "email").trim() || "email";

  const configured =
    !isPlaceholderCredential(clientId) && !isPlaceholderCredential(clientSecret);
  return { apiBase, clientId, clientSecret, redirectUri, scope, configured };
}

function createOAuthState() {
  return crypto.randomBytes(16).toString("hex");
}

function buildAuthorizeUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scope,
    state,
  });
  return `${config.apiBase}/web/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(config, code) {
  const res = await fetch(`${config.apiBase}/web/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data.error_description || data.error || `token_exchange_failed (${res.status})`;
    throw new Error(msg);
  }
  if (!data.access_token) {
    throw new Error("access_token이 응답에 없습니다.");
  }
  return data;
}

async function verifyAccessToken(config, accessToken) {
  const res = await fetch(`${config.apiBase}/web/verify-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      token: accessToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated) {
    const msg =
      data.error_description || data.error || `verify_token_failed (${res.status})`;
    throw new Error(msg);
  }
  return data.user || {};
}

function displayNameFromBioPassUser(user) {
  if (user.email) return String(user.email);
  if (user.name) return String(user.name);
  if (user.phone) return String(user.phone);
  if (user.id) return String(user.id);
  return "Bio-Pass 사용자";
}

module.exports = {
  getBioPassConfig,
  createOAuthState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  verifyAccessToken,
  displayNameFromBioPassUser,
};
