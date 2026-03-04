const fs = require("fs");
const https = require("https");
const next = require("next");

const dev = true;
const app = next({ dev });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: fs.readFileSync("./certificates/local.sunbnb.app-key.pem"),
  cert: fs.readFileSync("./certificates/local.sunbnb.app.pem"),
};

app.prepare().then(() => {
  https
    .createServer(httpsOptions, (req, res) => {
      handle(req, res);
    })
    .listen(3003, () => {
      console.log("🚀 HTTPS server ready at https://local.sunbnb.app:3003");
    });
});
