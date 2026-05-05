require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const expressLayouts = require("express-ejs-layouts");

const BASE_DIR = __dirname;
const DATABASE_PATH = path.join(BASE_DIR, "app.db");

let db;

function persistDb() {
  const data = db.export();
  fs.writeFileSync(DATABASE_PATH, Buffer.from(data));
}

function initSchemaAndSeed() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
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
  res.render("login", { title: "로그인" });
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

  res.render("dashboard", {
    title: "대시보드",
    username: req.session.username || "",
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
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
