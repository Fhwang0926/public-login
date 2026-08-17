const {
  getBioPassConfig,
  BIO_PASS_OVERRIDE_FIELDS,
} = require("./biopass");
const { isUpdateEnabled } = require("./selfUpdate");

function envRow(key, rawEnv, effectiveValue, options = {}) {
  const raw = rawEnv === undefined || rawEnv === null ? "" : String(rawEnv);
  const value =
    effectiveValue !== undefined && effectiveValue !== null
      ? String(effectiveValue)
      : raw;
  const isUnset = raw.trim() === "";
  let note = options.note || null;
  if (isUnset && options.emptyLabel && !value.trim()) {
    return { key, value: `(${options.emptyLabel})`, note };
  }
  if (!note && options.defaultUsed && isUnset) {
    note = "기본값";
  }
  return { key, value: value || "(비어 있음)", note };
}

function getAppEnvDisplayRows(overrides = {}) {
  const port = Number(process.env.PORT) || 5000;
  const cfg = getBioPassConfig(overrides);
  const overridden = new Set(cfg.overriddenKeys || []);

  const overrideNote = (key) => (overridden.has(key) ? "세션 오버라이드" : null);

  return [
    envRow("PORT", process.env.PORT, String(port), { defaultUsed: true }),
    envRow(
      "SECRET_KEY",
      process.env.SECRET_KEY,
      process.env.SECRET_KEY ? "(설정됨)" : "(미설정)",
      { emptyLabel: "미설정" }
    ),
    envRow("BIO_PASS_API", process.env.BIO_PASS_API, cfg.apiBase, {
      defaultUsed: true,
      note: overrideNote("apiBase"),
    }),
    envRow("BIO_PASS_CLIENT_ID", process.env.BIO_PASS_CLIENT_ID, cfg.clientId, {
      emptyLabel: "미설정",
      note: overrideNote("clientId"),
    }),
    envRow(
      "BIO_PASS_CLIENT_SECRET",
      process.env.BIO_PASS_CLIENT_SECRET,
      cfg.clientSecret ? "(설정됨)" : "(미설정)",
      {
        emptyLabel: "미설정",
        note: overrideNote("clientSecret"),
      }
    ),
    envRow("BIO_PASS_REDIRECT_URI", process.env.BIO_PASS_REDIRECT_URI, cfg.redirectUri, {
      defaultUsed: true,
      note: overrideNote("redirectUri"),
    }),
    envRow(
      "BIO_PASS_OAUTH_STATE",
      process.env.BIO_PASS_OAUTH_STATE,
      cfg.oauthState ? "(설정됨)" : "(미설정)",
      {
        emptyLabel: "미설정",
        note: overrideNote("oauthState"),
      }
    ),
    envRow("BIO_PASS_SCOPE", process.env.BIO_PASS_SCOPE, cfg.scope, {
      defaultUsed: true,
    }),
    envRow(
      "UPDATE_ENABLED",
      process.env.UPDATE_ENABLED,
      isUpdateEnabled() ? "1 (활성)" : "0 (비활성)",
      { defaultUsed: true }
    ),
    envRow(
      "UPDATE_SECRET",
      process.env.UPDATE_SECRET,
      process.env.UPDATE_SECRET ? "(설정됨)" : "(미설정)",
      { emptyLabel: "미설정" }
    ),
  ];
}

/** 로그인 화면 Bio-Pass 오버라이드 폼용 필드 */
function getBioPassOverrideFormFields(overrides = {}) {
  const cfg = getBioPassConfig(overrides);
  const active = new Set(cfg.overriddenKeys || []);

  return BIO_PASS_OVERRIDE_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    value: cfg[field.key] || "",
    overridden: active.has(field.key),
    envDefault: String(process.env[field.envKey] || "").trim(),
  }));
}

module.exports = { getAppEnvDisplayRows, getBioPassOverrideFormFields };
