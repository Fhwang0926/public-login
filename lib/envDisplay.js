const { getBioPassConfig } = require("./biopass");
const { isUpdateEnabled } = require("./selfUpdate");

function envRow(key, rawEnv, effectiveValue, options = {}) {
  const raw = rawEnv === undefined || rawEnv === null ? "" : String(rawEnv);
  const value =
    effectiveValue !== undefined && effectiveValue !== null
      ? String(effectiveValue)
      : raw;
  const isUnset = raw.trim() === "";
  let note = options.note || null;
  if (isUnset && options.emptyLabel) {
    return { key, value: `(${options.emptyLabel})`, note: null };
  }
  if (!note && options.defaultUsed && isUnset) {
    note = "기본값";
  }
  return { key, value: value || "(비어 있음)", note };
}

function getAppEnvDisplayRows() {
  const port = Number(process.env.PORT) || 5000;
  const cfg = getBioPassConfig();

  return [
    envRow("PORT", process.env.PORT, String(port), { defaultUsed: true }),
    envRow("SECRET_KEY", process.env.SECRET_KEY, process.env.SECRET_KEY || "dev-change-me-in-production", {
      defaultUsed: true,
    }),
    envRow("BIO_PASS_API", process.env.BIO_PASS_API, cfg.apiBase, { defaultUsed: true }),
    envRow("BIO_PASS_CLIENT_ID", process.env.BIO_PASS_CLIENT_ID, cfg.clientId, {
      emptyLabel: "미설정",
    }),
    envRow("BIO_PASS_CLIENT_SECRET", process.env.BIO_PASS_CLIENT_SECRET, cfg.clientSecret, {
      emptyLabel: "미설정",
    }),
    envRow("BIO_PASS_REDIRECT_URI", process.env.BIO_PASS_REDIRECT_URI, cfg.redirectUri, {
      defaultUsed: true,
    }),
    envRow("BIO_PASS_OAUTH_STATE", process.env.BIO_PASS_OAUTH_STATE, cfg.oauthState, {
      emptyLabel: "미설정",
    }),
    envRow("BIO_PASS_SCOPE", process.env.BIO_PASS_SCOPE, cfg.scope, { defaultUsed: true }),
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

module.exports = { getAppEnvDisplayRows };
