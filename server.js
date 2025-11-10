const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const path = require('path');

const app = express();
app.use(bodyParser.json());
const fs = require('fs');

// Paths for persisted data
const VAPID_FILE = path.join(__dirname, 'vapid.json');
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');

// Load or generate VAPID keys and persist them so keys survive restarts
function loadOrCreateVapid() {
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const data = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      console.log('Loaded VAPID keys from file.');
      return data;
    }
  } catch (e) {
    console.error('Failed reading VAPID file, will generate new keys', e);
  }
  const keys = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
    console.log('Generated and saved new VAPID keys to', VAPID_FILE);
  } catch (e) {
    console.error('Failed to save VAPID keys to file', e);
  }
  return keys;
}

const vapidKeys = loadOrCreateVapid();
console.log('VAPID Public Key:', vapidKeys.publicKey);
// Do not log private key in production, kept here for local demo
console.log('VAPID Private Key:', vapidKeys.privateKey);

webpush.setVapidDetails('mailto:example@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

// Load subscriptions from disk (if any)
let subscriptions = [];
try {
  if (fs.existsSync(SUBS_FILE)) {
    const raw = fs.readFileSync(SUBS_FILE, 'utf8');
    subscriptions = JSON.parse(raw) || [];
    console.log(`Loaded ${subscriptions.length} subscriptions from file.`);
  }
} catch (e) {
  console.error('Failed to load subscriptions file', e);
  subscriptions = [];
}

// Serve static files from this directory (so task1.html and service-worker.js are available)
app.use(express.static(path.join(__dirname)));

// Endpoint to provide public VAPID key to clients
app.get('/vapidPublicKey', (req, res) => {
  res.send(vapidKeys.publicKey);
});

// Explicit route to serve task1.html (workaround for any static-serving issues)
app.get('/task1.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'task1.html'));
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  // Avoid duplicate subscriptions (same endpoint)
  const exists = subscriptions.find(s => s.endpoint === sub.endpoint);
  if (!exists) {
    subscriptions.push(sub);
    try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2)); } catch (e) { console.error('Failed to persist subscriptions', e); }
    console.log('New subscription saved. Total:', subscriptions.length);
  } else {
    console.log('Subscription already exists:', sub.endpoint);
  }
  res.json({ success: true });
});

app.post('/sendNotification', async (req, res) => {
  const { title, body, url } = req.body;
  const payload = JSON.stringify({ title, body, url });
  try {
    const results = await Promise.allSettled(subscriptions.map(s => webpush.sendNotification(s, payload).then(() => ({ok:true})).catch(err => { throw { err, endpoint: s.endpoint }; })));
    // Clean up subscriptions that failed with unrecoverable errors
    const toRemove = [];
    results.forEach(r => {
      if (r.status === 'rejected' && r.reason && r.reason.err) {
        const e = r.reason.err;
        const endpoint = r.reason.endpoint;
        console.error('Send failed for', endpoint, e.statusCode || e.message || e);
        // common patterns: 404 / 410 mean subscription is gone
        if (e.statusCode === 404 || e.statusCode === 410) toRemove.push(endpoint);
      }
    });
    if (toRemove.length > 0) {
      subscriptions = subscriptions.filter(s => !toRemove.includes(s.endpoint));
      try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2)); } catch (e) { console.error('Failed to persist subscriptions after cleanup', e); }
      console.log('Removed', toRemove.length, 'stale subscriptions. Remaining:', subscriptions.length);
    }
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('Push server running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on 0.0.0.0:${PORT}`));
