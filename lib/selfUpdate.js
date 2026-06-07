const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

const execFileAsync = promisify(execFile);

const RESTART_EXIT_CODE = 75;

function isUpdateEnabled() {
  const v = String(process.env.UPDATE_ENABLED ?? "")
    .trim()
    .toLowerCase();
  if (!v) {
    return true;
  }
  if (v === "0" || v === "false" || v === "no") {
    return false;
  }
  return v === "1" || v === "true" || v === "yes";
}

function isRestartWrapperActive() {
  return String(process.env.PUBLIC_LOGIN_RESTART_WRAPPER || "") === "1";
}

async function runGit(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || "").trim(),
      stderr: String(err.stderr || err.message || "").trim(),
    };
  }
}

async function runCommand(command, args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || "").trim(),
      stderr: String(err.stderr || err.message || "").trim(),
    };
  }
}

async function getUpdateStatus(repoDir) {
  const enabled = isUpdateEnabled();
  const isRepo = fs.existsSync(path.join(repoDir, ".git"));

  if (!isRepo) {
    return {
      enabled,
      isRepo: false,
      canUpdate: false,
      message: "Git 저장소가 아닙니다.",
    };
  }

  const branchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoDir);
  const commitResult = await runGit(["rev-parse", "--short", "HEAD"], repoDir);
  const subjectResult = await runGit(["log", "-1", "--pretty=%s"], repoDir);
  const statusResult = await runGit(["status", "--porcelain"], repoDir);
  const upstreamResult = await runGit(["rev-parse", "--abbrev-ref", "@{u}"], repoDir);

  const dirty = Boolean(statusResult.stdout);
  const hasUpstream = upstreamResult.ok;

  let behind = 0;
  let ahead = 0;
  let fetchError = null;

  if (hasUpstream) {
    const fetchResult = await runGit(["fetch", "--quiet"], repoDir);
    if (!fetchResult.ok) {
      fetchError = fetchResult.stderr || "git fetch 실패";
    } else {
      const behindResult = await runGit(["rev-list", "--count", "HEAD..@{u}"], repoDir);
      const aheadResult = await runGit(["rev-list", "--count", "@{u}..HEAD"], repoDir);
      behind = behindResult.ok ? Number(behindResult.stdout) || 0 : 0;
      ahead = aheadResult.ok ? Number(aheadResult.stdout) || 0 : 0;
    }
  }

  const canUpdate =
    enabled && hasUpstream && !dirty && behind > 0 && !fetchError;

  let message = null;
  if (!enabled) {
    message = "자동 업데이트가 비활성화되어 있습니다. UPDATE_ENABLED=0 이면 끕니다.";
  } else if (dirty) {
    message = "로컬 변경 파일이 있어 pull 할 수 없습니다. git status 로 확인하세요.";
  } else if (!hasUpstream) {
    message = "upstream 브랜치가 없습니다. git push -u origin <branch> 로 설정하세요.";
  } else if (fetchError) {
    message = fetchError;
  } else if (behind === 0) {
    message = "이미 최신 커밋입니다.";
  }

  return {
    enabled,
    isRepo: true,
    branch: branchResult.ok ? branchResult.stdout : null,
    commit: commitResult.ok ? commitResult.stdout : null,
    commitSubject: subjectResult.ok ? subjectResult.stdout : null,
    dirty,
    hasUpstream,
    behind,
    ahead,
    fetchError,
    canUpdate,
    message,
    restartWrapper: isRestartWrapperActive(),
  };
}

async function npmInstallIfNeeded(repoDir) {
  const diff = await runGit(["diff", "--name-only", "ORIG_HEAD", "HEAD"], repoDir);
  if (!diff.ok || !diff.stdout) {
    return { ran: false, output: "" };
  }

  const changed = diff.stdout.split("\n").map((line) => line.trim());
  const needsInstall = changed.some(
    (file) =>
      file === "package.json" ||
      file === "package-lock.json" ||
      file === "yarn.lock"
  );
  if (!needsInstall) {
    return { ran: false, output: "" };
  }

  const npmResult = await runCommand("npm", ["install", "--omit=dev"], repoDir);
  if (!npmResult.ok) {
    throw new Error(npmResult.stderr || "npm install 실패");
  }
  return { ran: true, output: npmResult.stdout || npmResult.stderr };
}

async function performSelfUpdate(repoDir) {
  if (!isUpdateEnabled()) {
    throw new Error("자동 업데이트가 비활성화되어 있습니다. UPDATE_ENABLED=0 으로 꺼져 있습니다.");
  }
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    throw new Error("Git 저장소가 아닙니다.");
  }

  const status = await getUpdateStatus(repoDir);
  if (status.dirty) {
    throw new Error("로컬 변경 파일이 있어 git pull 을 실행할 수 없습니다.");
  }
  if (!status.hasUpstream) {
    throw new Error("upstream 브랜치가 설정되어 있지 않습니다.");
  }
  if (status.fetchError) {
    throw new Error(status.fetchError);
  }
  if (status.behind === 0) {
    return {
      pulled: false,
      message: "이미 최신 커밋입니다.",
      npmInstall: { ran: false, output: "" },
      pullOutput: "",
      beforeCommit: status.commit,
      afterCommit: status.commit,
    };
  }

  const beforeCommit = status.commit;
  const pullResult = await runGit(["pull", "--ff-only"], repoDir);
  if (!pullResult.ok) {
    throw new Error(pullResult.stderr || pullResult.stdout || "git pull 실패");
  }

  const afterCommitResult = await runGit(["rev-parse", "--short", "HEAD"], repoDir);
  const npmInstall = await npmInstallIfNeeded(repoDir);

  return {
    pulled: true,
    message: "업데이트를 적용했습니다. 서버를 재시작합니다.",
    npmInstall,
    pullOutput: pullResult.stdout || pullResult.stderr,
    beforeCommit,
    afterCommit: afterCommitResult.ok ? afterCommitResult.stdout : null,
  };
}

function scheduleProcessRestart(repoDir, delayMs = 400) {
  setTimeout(() => {
    if (isRestartWrapperActive()) {
      process.exit(RESTART_EXIT_CODE);
      return;
    }

    const child = spawn(process.execPath, [path.join(repoDir, "server.js")], {
      detached: true,
      stdio: "ignore",
      cwd: repoDir,
      env: process.env,
    });
    child.unref();
    process.exit(0);
  }, delayMs);
}

function verifyUpdateSecret(provided) {
  const expected = String(process.env.UPDATE_SECRET || "").trim();
  if (!expected) {
    return true;
  }
  return String(provided || "").trim() === expected;
}

function canManageUpdate(req) {
  if (!req.session || !req.session.userId) {
    return false;
  }
  if (req.session.username !== "admin" || req.session.authProvider !== "local") {
    return false;
  }
  return true;
}

module.exports = {
  RESTART_EXIT_CODE,
  isUpdateEnabled,
  getUpdateStatus,
  performSelfUpdate,
  scheduleProcessRestart,
  verifyUpdateSecret,
  canManageUpdate,
};
