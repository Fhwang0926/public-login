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
  const scope =
    String(process.env.BIO_PASS_SCOPE || "email,phone").trim() || "email,phone";
  const oauthState = String(process.env.BIO_PASS_OAUTH_STATE || "").trim();

  const configured =
    !isPlaceholderCredential(clientId) && !isPlaceholderCredential(clientSecret);
  const secretLooksWrong =
    configured &&
    (clientSecret === clientId ||
      (clientSecret.startsWith("app_") && !clientSecret.startsWith("secret_")));
  return {
    apiBase,
    clientId,
    clientSecret,
    redirectUri,
    scope,
    oauthState,
    configured,
    secretLooksWrong,
  };
}

function assertClientSecretLooksValid(config) {
  if (!config.configured) return;
  if (config.clientSecret === config.clientId) {
    throw new Error(
      "BIO_PASS_CLIENT_SECRET에 Client ID를 넣었습니다. bio-pass 앱 상세 화면의 Client Secret(secret_로 시작)을 복사하세요."
    );
  }
  if (config.secretLooksWrong) {
    throw new Error(
      "Client Secret 형식이 올바르지 않습니다. bio-pass에서 secret_로 시작하는 값을 확인하세요."
    );
  }
}

/** 세션 state 또는 BIO_PASS_OAUTH_STATE(예: test)와 비교 */
function validateOAuthState(req, state, config) {
  const fromSession = req.session && req.session.oauthState;
  const expected = fromSession || config.oauthState || "";
  if (!expected) return true;
  return String(state || "") === expected;
}

function initialOAuthState(config) {
  return config.oauthState || createOAuthState();
}

async function authenticateWithBioPassCode(config, code) {
  assertClientSecretLooksValid(config);
  const token = await exchangeCodeForToken(config, code);
  const verifyResult = await verifyAccessToken(config, token.access_token);
  return { token, verifyResult, profile: verifyResult.user || {} };
}

function maskToken(token) {
  const t = String(token || "");
  if (t.length <= 16) return "••••••••";
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
}

function createOAuthState() {
  return crypto.randomBytes(16).toString("hex");
}

function buildAuthorizeUrl(config, state, options = {}) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scope,
    state,
  });

  const email = String(options.email || "").trim();
  if (email) {
    params.set("email", email);
  }

  const phone = String(options.phone || "").trim();
  if (phone) {
    params.set("phone", phone);
  }

  return `${config.apiBase}/web/authorize?${params.toString()}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  if (!res.ok || data.success !== true || data.authenticated !== true) {
    const msg =
      data.error_description || data.error || `verify_token_failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/** bio-pass POST /web/verify-token → user 필드 (resolveVerifiedUser) */
const VERIFY_USER_FIELD_ORDER = ["id", "email", "name", "nickname", "phone", "status"];

const VERIFY_USER_FIELD_LABELS = {
  id: "id",
  email: "email",
  name: "name",
  nickname: "nickname",
  phone: "phone",
  status: "status",
};

const VERIFY_USER_FIELD_LABELS_KO = {
  id: "사용자 ID",
  email: "이메일",
  name: "이름",
  nickname: "닉네임",
  phone: "전화번호",
  status: "상태",
};

/** verify-token user 객체를 bio-pass 응답 순서대로 표시 (null 포함) */
function verifyUserToDisplayRows(user) {
  const u = user || {};
  return VERIFY_USER_FIELD_ORDER.map((key) => {
    const raw = u[key];
    return {
      field: key,
      label: VERIFY_USER_FIELD_LABELS_KO[key] || key,
      apiKey: VERIFY_USER_FIELD_LABELS[key] || key,
      isNull: raw == null,
      displayValue: raw == null ? "null" : String(raw),
      isCode: key === "id",
    };
  });
}

function objectToDisplayRows(obj, labelMap = VERIFY_USER_FIELD_LABELS_KO) {
  if (!obj || typeof obj !== "object") return [];
  const rows = [];
  const used = new Set();

  for (const [key, label] of Object.entries(labelMap)) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") continue;
    used.add(key);
    rows.push({
      label,
      value:
        typeof obj[key] === "object" ? JSON.stringify(obj[key]) : String(obj[key]),
      isCode: key === "id",
    });
  }

  for (const key of Object.keys(obj)) {
    if (used.has(key)) continue;
    if (obj[key] === undefined || obj[key] === null) continue;
    rows.push({
      label: key,
      value:
        typeof obj[key] === "object" ? JSON.stringify(obj[key]) : String(obj[key]),
      isCode: false,
    });
  }
  return rows;
}

function buildAuthResultForSession(config, token, verifyResult, options = {}) {
  const code = options.code ? maskToken(String(options.code)) : "—";

  return {
    tokenRequest: {
      endpoint: `${config.apiBase}/web/token`,
      method: "POST",
      contentType: "application/json",
      body: {
        grant_type: "authorization_code",
        code,
        client_id: config.clientId,
        client_secret: maskToken(config.clientSecret),
        redirect_uri: config.redirectUri,
      },
    },
    tokenResponse: {
      access_token: maskToken(token.access_token),
      token_type: token.token_type || "Bearer",
      expires_in: token.expires_in != null ? token.expires_in : null,
      refresh_token: token.refresh_token ? maskToken(token.refresh_token) : null,
      scope: token.scope != null ? token.scope : null,
    },
    verifyRequest: {
      endpoint: `${config.apiBase}/web/verify-token`,
      method: "POST",
      contentType: "application/json",
      body: {
        token: maskToken(token.access_token),
        client_id: config.clientId,
        client_secret: maskToken(config.clientSecret),
      },
    },
    verifyResponse: {
      success: verifyResult.success === true,
      authenticated: verifyResult.authenticated === true,
      user: verifyResult.user || {},
    },
  };
}

function displayNameFromBioPassUser(user) {
  if (user.name) return String(user.name);
  if (user.nickname) return String(user.nickname);
  if (user.email) return String(user.email);
  if (user.phone) return String(user.phone);
  if (user.id) return String(user.id);
  return "Bio-Pass 사용자";
}

module.exports = {
  getBioPassConfig,
  createOAuthState,
  buildAuthorizeUrl,
  isValidEmail,
  exchangeCodeForToken,
  verifyAccessToken,
  displayNameFromBioPassUser,
  validateOAuthState,
  initialOAuthState,
  authenticateWithBioPassCode,
  assertClientSecretLooksValid,
  maskToken,
  objectToDisplayRows,
  verifyUserToDisplayRows,
  buildAuthResultForSession,
  VERIFY_USER_FIELD_ORDER,
};
