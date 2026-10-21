const os = require("node:os");

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME || process.env.USER || "ktv-user",
    uid: -1,
    gid: -1,
    shell: null,
    homedir: os.homedir(),
  });
}
