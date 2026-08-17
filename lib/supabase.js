const crypto = require("crypto");

/** Supabase GoTrue가 지원하는 소셜 로그인 (이 데모에서 노출할 provider) */
const SUPPORTED_PROVIDERS = {
  google: { label: "Google", brand: "google" },
  kakao: { label: "Kakao", brand: "kakao" },
};

function trimSlash(url) {
  return String(url || "").replace(/\/$/, "");
}

function getSupabaseConfig() {
  const port = Number(process.env.PORT) || 5000;
  const url = trimSlash(process.env.SUPABASE_URL || "");
  const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  const redirectUri =
    String(process.env.SUPABASE_REDIRECT_URI || "").trim() ||
    `http://localhost:${port}/auth/supabase/callback`;

  const configured = Boolean(url) && Boolean(anonKey);
  return { url, anonKey, redirectUri, configured };
}

function isSupportedProvider(provider) {
  return Object.prototype.hasOwnProperty.call(
    SUPPORTED_PROVIDERS,
    String(provider || "").toLowerCase()
  );
}

function listProviders() {
  return Object.entries(SUPPORTED_PROVIDERS).map(([key, meta]) => ({
    key,
    label: meta.label,
    brand: meta.brand,
  }));
}

function providerLabel(provider) {
  const meta = SUPPORTED_PROVIDERS[String(provider || "").toLowerCase()];
  return (meta && meta.label) || String(provider || "");
}

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** PKCE code_verifier / code_challenge(S256) 쌍 생성 */
function createPkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
}

/**
 * Supabase GoTrue /authorize URL (PKCE). code_challenge를 넘기면
 * 콜백으로 ?code=... 가 전달되어 서버에서 교환할 수 있습니다.
 */
function buildAuthorizeUrl(config, provider, { challenge }) {
  const params = new URLSearchParams({
    provider: String(provider).toLowerCase(),
    redirect_to: config.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "s256",
  });
  return `${config.url}/auth/v1/authorize?${params.toString()}`;
}

/** authorization code → 세션(access_token / user 등) 교환 */
async function exchangeCodeForSession(config, code, verifier) {
  const res = await fetch(`${config.url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
    },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data.error_description ||
      data.msg ||
      data.error ||
      `token_exchange_failed (${res.status})`;
    throw new Error(msg);
  }
  if (!data.user) {
    throw new Error("Supabase 응답에 user 정보가 없습니다.");
  }
  return data;
}

function maskToken(token) {
  const t = String(token || "");
  if (!t) return "—";
  if (t.length <= 16) return "••••••••";
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
}

function displayNameFromSupabaseUser(user) {
  const meta = (user && user.user_metadata) || {};
  return (
    meta.full_name ||
    meta.name ||
    meta.user_name ||
    meta.preferred_username ||
    user.email ||
    user.phone ||
    user.id ||
    "Supabase 사용자"
  );
}

const SUPABASE_USER_FIELD_ORDER = [
  "id",
  "email",
  "phone",
  "provider",
  "full_name",
  "avatar_url",
  "created_at",
];

const SUPABASE_USER_FIELD_LABELS_KO = {
  id: "사용자 ID",
  email: "이메일",
  phone: "전화번호",
  provider: "로그인 수단",
  full_name: "이름",
  avatar_url: "프로필 이미지",
  created_at: "가입 시각",
};

/** Supabase user 객체를 대시보드 표시용 행으로 변환 */
function supabaseUserToDisplayRows(user) {
  const u = user || {};
  const meta = u.user_metadata || {};
  const appMeta = u.app_metadata || {};
  const values = {
    id: u.id,
    email: u.email,
    phone: u.phone,
    provider: appMeta.provider || (appMeta.providers && appMeta.providers[0]),
    full_name: meta.full_name || meta.name,
    avatar_url: meta.avatar_url || meta.picture,
    created_at: u.created_at,
  };

  return SUPABASE_USER_FIELD_ORDER.map((key) => {
    const raw = values[key];
    return {
      field: key,
      label: SUPABASE_USER_FIELD_LABELS_KO[key] || key,
      apiKey: key,
      isNull: raw == null || raw === "",
      displayValue: raw == null || raw === "" ? "null" : String(raw),
      isCode: key === "id",
    };
  });
}

function buildSupabaseAuthResult(config, provider, session) {
  const token = session || {};
  return {
    provider,
    providerLabel: providerLabel(provider),
    tokenRequest: {
      endpoint: `${config.url}/auth/v1/token?grant_type=pkce`,
      method: "POST",
      contentType: "application/json",
      body: {
        grant_type: "pkce",
        auth_code: maskToken(token.__authCode),
        code_verifier: maskToken(token.__verifier),
      },
    },
    tokenResponse: {
      access_token: maskToken(token.access_token),
      token_type: token.token_type || "bearer",
      expires_in: token.expires_in != null ? token.expires_in : null,
      refresh_token: token.refresh_token ? maskToken(token.refresh_token) : null,
    },
    user: supabaseUserToDisplayRows(token.user),
  };
}

module.exports = {
  SUPPORTED_PROVIDERS,
  getSupabaseConfig,
  isSupportedProvider,
  listProviders,
  providerLabel,
  createPkcePair,
  buildAuthorizeUrl,
  exchangeCodeForSession,
  displayNameFromSupabaseUser,
  supabaseUserToDisplayRows,
  buildSupabaseAuthResult,
  maskToken,
};
