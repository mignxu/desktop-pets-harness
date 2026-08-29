// 入口分发:v0 spike(npm run spikes)与 v1 产品(默认)。
const argv = process.argv.slice(1);
if (argv.includes("--self-test")) {
  require("./spike-main.js");
} else {
  require("./v1-main.js");
}
