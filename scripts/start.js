const { spawn } = require("child_process");
const path = require("path");

const { RESTART_EXIT_CODE } = require("../lib/selfUpdate");

const serverScript = path.join(__dirname, "..", "server.js");

function startServer() {
  const child = spawn(process.execPath, [serverScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      PUBLIC_LOGIN_RESTART_WRAPPER: "1",
    },
  });

  child.on("exit", (code, signal) => {
    if (code === RESTART_EXIT_CODE) {
      console.log("[start] 업데이트 후 서버를 재시작합니다...");
      startServer();
      return;
    }
    if (signal) {
      process.exit(1);
      return;
    }
    process.exit(code ?? 0);
  });
}

startServer();
