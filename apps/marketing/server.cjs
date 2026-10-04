// Local HTTPS dev server on https://local.sunbnb.app:3004 — same setup as the user app
// (server.js there). HTTPS + the local.sunbnb.app host matter: the referrer-restricted Maps
// client key only works on allowed hosts. Certificates: mkcert, in ./certificates (gitignored).
const fs = require('fs')
const https = require('https')
const next = require('next')

const app = next({ dev: true })
const handle = app.getRequestHandler()

const httpsOptions = {
  key: fs.readFileSync('./certificates/local.sunbnb.app-key.pem'),
  cert: fs.readFileSync('./certificates/local.sunbnb.app.pem'),
}

app.prepare().then(() => {
  https.createServer(httpsOptions, (req, res) => handle(req, res)).listen(3004, () => {
    console.log('🚀 HTTPS server ready at https://local.sunbnb.app:3004')
  })
})
