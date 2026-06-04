require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const expressLayouts = require("express-ejs-layouts");
const {
  getBioPassConfig,
  buildAuthorizeUrl,
  isValidEmail,
  displayNameFromBioPassUser,
  validateOAuthState,
  initialOAuthState,
  authenticateWithBioPassCode,
  verifyUserToDisplayRows,
  buildAuthResultForSession,
} = require("./lib/biopass");

const BASE_DIR = __dirname;
const bioPassConfig = getBioPassConfig();
const DATABASE_PATH = path.join(BASE_DIR, "app.db");

let db;

function persistDb() {
  const data = db.export();
  fs.writeFileSync(DATABASE_PATH, Buffer.from(data));
}

function ensureUsersBioPassColumn() {
  const info = db.exec("PRAGMA table_info(users)");
  if (!info.length || !info[0].values) return;
  const hasBioPassId = info[0].values.some((row) => row[1] === "bio_pass_id");
  if (!hasBioPassId) {
    db.run("ALTER TABLE users ADD COLUMN bio_pass_id TEXT");
    db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_bio_pass_id ON users(bio_pass_id) WHERE bio_pass_id IS NOT NULL"
    );
    persistDb();
  }
}

function initSchemaAndSeed() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio_pass_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  ensureUsersBioPassColumn();
  db.run(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      logged_in_at TEXT NOT NULL,
      ip_address TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  const exists = db.exec("SELECT id FROM users WHERE username = 'admin'");
  const hasAdmin =
    exists.length > 0 && exists[0].values && exists[0].values.length > 0;
  if (!hasAdmin) {
    const hash = bcrypt.hashSync("admin", 10);
    const now = new Date().toISOString();
    db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)", [
      "admin",
      hash,
      now,
    ]);
    persistDb();
  }
}

function getUserByUsername(username) {
  const stmt = db.prepare("SELECT id, password_hash FROM users WHERE username = ?");
  stmt.bind([username]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return row;
}

function getUserByBioPassId(bioPassId) {
  const stmt = db.prepare("SELECT id, username FROM users WHERE bio_pass_id = ?");
  stmt.bind([bioPassId]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return row;
}

function upsertBioPassUser(bioPassId, username) {
  const existing = getUserByBioPassId(bioPassId);
  if (existing) {
    if (existing.username !== username) {
      db.run("UPDATE users SET username = ? WHERE id = ?", [username, existing.id]);
      persistDb();
    }
    return existing.id;
  }

  const now = new Date().toISOString();
  const placeholderHash = bcrypt.hashSync(`biopass:${bioPassId}:${now}`, 10);
  db.run(
    "INSERT INTO users (username, password_hash, bio_pass_id, created_at) VALUES (?, ?, ?, ?)",
    [username, placeholderHash, bioPassId, now]
  );
  persistDb();

  const stmt = db.prepare("SELECT id FROM users WHERE bio_pass_id = ?");
  stmt.bind([bioPassId]);
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return row.id;
}

function insertLoginLog(userId, loggedAt, ip) {
  db.run("INSERT INTO login_logs (user_id, logged_in_at, ip_address) VALUES (?, ?, ?)", [
    userId,
    loggedAt,
    ip,
  ]);
  persistDb();
}

function getLoginLogsForUser(userId) {
  const stmt = db.prepare(`
    SELECT logged_in_at, ip_address
    FROM login_logs
    WHERE user_id = ?
    ORDER BY logged_in_at DESC
  `);
  stmt.bind([userId]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

const app = express();

app.set("views", path.join(BASE_DIR, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(BASE_DIR, "public")));

app.use(
  session({
    secret: process.env.SECRET_KEY || "dev-change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);
app.use(flash());

app.use((req, res, next) => {
  res.locals.flashSuccess = req.flash("success");
  res.locals.flashError = req.flash("error");
  res.locals.bioPassConfigured = bioPassConfig.configured;
  res.locals.bioPassSecretMisconfigured = bioPassConfig.secretLooksWrong;
  next();
});

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "";
}

app.get("/", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/dashboard");
  }
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/dashboard");
  }
  if (req.query.out === "1") {
    const cur = res.locals.flashSuccess || [];
    res.locals.flashSuccess = cur.concat(["로그아웃되었습니다."]);
  }
  res.render("login", {
    title: "로그인",
    bioPassConfigured: bioPassConfig.configured,
    bioPassSecretMisconfigured: bioPassConfig.secretLooksWrong,
  });
});

app.get("/auth/biopass", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/dashboard");
  }
  if (!bioPassConfig.configured) {
    req.flash("error", "Bio-Pass 연동 설정이 없습니다. .env를 확인하세요.");
    return res.redirect("/login");
  }

  const email = String(req.query.email || "").trim();
  if (!email) {
    req.flash("error", "Bio-Pass 로그인에는 이메일이 필요합니다.");
    return res.redirect("/login");
  }
  if (!isValidEmail(email)) {
    req.flash("error", "올바른 이메일 주소를 입력해 주세요.");
    return res.redirect("/login");
  }

  const state = initialOAuthState(bioPassConfig);
  req.session.oauthState = state;
  req.session.bioPassLoginEmail = email;

  const phone = String(req.query.phone || "").trim();
  return res.redirect(
    buildAuthorizeUrl(bioPassConfig, state, { email, phone: phone || undefined })
  );
});

app.get("/auth/callback", async (req, res) => {
  if (req.session.userId) {
    return res.redirect("/dashboard");
  }

  const oauthError = req.query.error;
  if (oauthError) {
    const desc = req.query.error_description
      ? String(req.query.error_description)
      : String(oauthError);
    req.flash("error", `Bio-Pass 인증이 취소되었거나 실패했습니다. (${desc})`);
    return res.redirect("/login");
  }

  if (!bioPassConfig.configured) {
    req.flash("error", "Bio-Pass 연동 설정이 없습니다. .env를 확인하세요.");
    return res.redirect("/login");
  }

  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();

  if (!code) {
    req.flash("error", "인증 코드가 없습니다.");
    return res.redirect("/login");
  }

  if (!validateOAuthState(req, state, bioPassConfig)) {
    req.flash(
      "error",
      "OAuth state가 일치하지 않습니다. (세션 또는 BIO_PASS_OAUTH_STATE 확인)"
    );
    return res.redirect("/login");
  }

  delete req.session.oauthState;

  try {
    const { token, verifyResult, profile } = await authenticateWithBioPassCode(
      bioPassConfig,
      code
    );
    const bioPassId = String(profile.id || "").trim();
    if (!bioPassId) {
      throw new Error("Bio-Pass 사용자 ID를 확인할 수 없습니다.");
    }

    const displayName = displayNameFromBioPassUser(profile);
    const userId = upsertBioPassUser(bioPassId, displayName);
    insertLoginLog(userId, new Date().toISOString(), clientIp(req));

    req.session.userId = userId;
    req.session.username = displayName;
    req.session.authProvider = "biopass";
    req.session.bioPassAuthResult = buildAuthResultForSession(
      bioPassConfig,
      token,
      verifyResult,
      { code }
    );
    req.flash("success", "Bio-Pass로 로그인되었습니다.");
    return res.redirect("/dashboard");
  } catch (err) {
    console.error("[biopass] callback error:", err.message);
    req.flash("error", `Bio-Pass 로그인에 실패했습니다. (${err.message})`);
    return res.redirect("/login");
  }
});

app.post("/login", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/dashboard");
  }

  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = getUserByUsername(username);

  if (user && bcrypt.compareSync(password, user.password_hash)) {
    const now = new Date().toISOString();
    const ip = clientIp(req);
    insertLoginLog(user.id, now, ip);

    req.session.userId = user.id;
    req.session.username = username;
    req.session.authProvider = "local";
    delete req.session.bioPassAuthResult;
    req.flash("success", "로그인되었습니다.");
    return res.redirect("/dashboard");
  }

  req.flash("error", "아이디 또는 비밀번호가 올바르지 않습니다.");
  return res.redirect("/login");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login?out=1");
  });
});

app.get("/dashboard", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const logs = getLoginLogsForUser(req.session.userId);
  const bioPassAuthResult = req.session.bioPassAuthResult || null;
  const verifyUserRows =
    bioPassAuthResult && bioPassAuthResult.verifyResponse
      ? verifyUserToDisplayRows(bioPassAuthResult.verifyResponse.user)
      : null;

  res.render("dashboard", {
    title: "대시보드",
    username: req.session.username || "",
    authProvider: req.session.authProvider || "local",
    bioPassAuthResult,
    verifyUserRows,
    logs,
  });
});

async function main() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DATABASE_PATH)) {
    const buf = fs.readFileSync(DATABASE_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  initSchemaAndSeed();

  const PORT = Number(process.env.PORT) || 5000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`http://0.0.0.0:${PORT}`);
    if (bioPassConfig.configured) {
      console.log(`Bio-Pass: ${bioPassConfig.apiBase} → callback ${bioPassConfig.redirectUri}`);
    } else {
      console.log("Bio-Pass: 미설정 (.env에 BIO_PASS_* 변수를 추가하면 연동됩니다)");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
