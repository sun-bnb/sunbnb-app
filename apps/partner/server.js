const fs = require("fs");
const http = require("http");
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
    .listen(3001, () => {
      console.log("🚀 HTTPS server ready at https://local.sunbnb.app:3001");
    });
  // Plain-HTTP listener for the mobile app's dev loop: a phone on the LAN can
  // neither resolve local.sunbnb.app (Mac-only /etc/hosts entry) nor trust the
  // mkcert certificate. Dev-only by construction — Vercel never runs server.js.
  http
    .createServer((req, res) => {
      handle(req, res);
    })
    .listen(3011, () => {
      console.log("📱 HTTP (mobile dev) ready at http://<LAN-IP>:3011");
    });
});
