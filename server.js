const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const path = require('path');

const app = express();
app.use(bodyParser.json());
const fs = require('fs');

// Add a middleware to log all requests for debugging
app.use((req, res, next) => {
  console.log(`Request received: ${req.method} ${req.url}`);
  next();
});

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
  const filePath = path.join(__dirname, 'task1.html');
  console.log(`Attempting to serve file from: ${filePath}`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error sending file:', err);
      res.status(500).send('Error sending file');
    }
  });
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
  const bodyObj = req.body || {};
  // Forward the entire JSON payload to subscribers so it can include task details
  const payload = JSON.stringify(bodyObj);
  console.log('Sending notification with payload summary:', Object.keys(bodyObj).length ? Object.keys(bodyObj) : '(empty)');
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
    // Persist a short-lived record of the notification we just sent so clients can poll on open
    try {
      const RECENT_FILE = path.join(__dirname, 'recentNotifications.json');
      let rec = [];
      try { if (fs.existsSync(RECENT_FILE)) rec = JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')) || []; } catch(e) { rec = []; }
      const now = Date.now();
      rec.push({ task: bodyObj.task || null, title: bodyObj.title || '', ts: now });
      // keep only last 100 entries and trim old (over 24h)
      rec = rec.filter(r => (now - (r.ts || 0)) < 24*60*60*1000).slice(-100);
      try { fs.writeFileSync(RECENT_FILE, JSON.stringify(rec, null, 2)); } catch(e) { console.error('Failed to write recent notifications', e); }
    } catch(e) { console.error('recent notification persist error', e); }
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Return recent notifications (short-lived) so clients can check on app open and show prompts
app.get('/recentNotifications', (req, res) => {
  try {
    const RECENT_FILE = path.join(__dirname, 'recentNotifications.json');
    let rec = [];
    try { if (fs.existsSync(RECENT_FILE)) rec = JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')) || []; } catch(e) { rec = []; }
    // return only items in the last 30 minutes by default
    const now = Date.now();
    rec = rec.filter(r => (now - (r.ts || 0)) < (30 * 60 * 1000));
    res.json({ recent: rec });
  } catch (e) {
    console.error('recentNotifications error', e);
    res.status(500).json({ recent: [] });
  }
});

// Endpoint for service-worker to record notification action clicks (so user can act from banner without opening app)
app.post('/recordAction', (req, res) => {
  try {
    const body = req.body || {};
    const action = body.action || 'unknown';
    const taskId = body.taskId || null;
    const ts = body.ts || Date.now();
    const entry = { action, taskId, ts, receivedAt: Date.now(), ip: req.ip };
    const ACTIONS_FILE = path.join(__dirname, 'actionHistory.json');
    let arr = [];
    try {
      if (fs.existsSync(ACTIONS_FILE)) arr = JSON.parse(fs.readFileSync(ACTIONS_FILE, 'utf8')) || [];
    } catch (e) { console.error('Failed to read action history file', e); }
    arr.push(entry);
    try { fs.writeFileSync(ACTIONS_FILE, JSON.stringify(arr, null, 2)); } catch (e) { console.error('Failed to persist action history', e); }
    console.log('Recorded action from service-worker:', entry);
    res.json({ success: true });
  } catch (e) {
    console.error('recordAction error', e);
    res.status(500).json({ error: 'failed to record' });
  }
});

// Simple chat endpoint. Responds with basic rule-based replies.
app.post('/chat', async (req, res) => {
  try {
    const msg = (req.body && req.body.message) ? String(req.body.message) : '';
    const context = (req.body && req.body.context) ? req.body.context : null;
    if (!msg) return res.json({ reply: 'メッセージが見当たりません。何か聞きたいことを入力してください。' });

    const low = msg.toLowerCase();
    // relaxed keyword-based replies with context support
    if (low.includes('help') || low.includes('ヘルプ') || low.includes('使い方') || low.includes('helpme')) {
      return res.json({ reply: '使い方: 「今すぐ全通知」「今すぐ期限一覧を表示」などのボタンを使ってください。タスクに関する質問は「今日のタスク」や「今週の締切」などで聞けます。' });
    }

    if ( (low.includes('今日') && low.includes('タスク')) || low.includes('today') || low.includes('今日の') ) {
      if (context && context.upcomingCount !== undefined) {
        return res.json({ reply: `現在、期限が来ている/これからのタスクが ${context.upcomingCount} 件あります。例: ${ (context.upcomingSample || []).map(x=>`${x.date} ${String(x.hour).padStart(2,'0')}:${String(x.minute).padStart(2,'0')} ${x.text}`).join(' / ') }` });
      }
      return res.json({ reply: '「今すぐ期限一覧を表示」を押すと、クライアント側で今日/近日中のタスク一覧を表示できます。' });
    }

    if (low.includes('送信') && low.includes('通知')) {
      return res.json({ reply: '「今すぐ全通知を飛ばす」または「今すぐ期限一覧を通知送信」を使ってください。' });
    }

    // If OPENAI_API_KEY is set, optionally forward to OpenAI (developer must set env variable)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      // Lazy require to avoid hard dependency if not used
      try {
        // Use global fetch (Node 18+). No external node-fetch dependency needed.
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: msg }], max_tokens: 300 })
        });
        if (resp.ok) {
          const j = await resp.json();
          const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content ? j.choices[0].message.content.trim() : '（応答が空です）';
          return res.json({ reply });
        } else {
          console.error('OpenAI call failed', resp.status);
        }
      } catch (e) {
        console.error('OpenAI forward error', e);
      }
    }

    // Use provided context to answer broadly if available
    if (context && context.upcomingCount !== undefined) {
      return res.json({ reply: `（要約情報から）今、期限が来ている/これからのタスクが ${context.upcomingCount} 件あります。サンプル: ${ (context.upcomingSample || []).map(x=>`${x.date} ${String(x.hour).padStart(2,'0')}:${String(x.minute).padStart(2,'0')} ${x.text}`).join(' / ') }` });
    }

    // fallback: be helpful and ask for clarification rather than blocking
    if (low.length < 80) {
      return res.json({ reply: `「${msg}」について詳しく教えてください。たとえば「今日のタスク」や「今週の締切を教えて」などと聞けます。` });
    }
    return res.json({ reply: 'すみません、よく分かりませんでした。もう少し具体的に質問してください。' });
  } catch (e) {
    console.error('chat error', e);
    res.status(500).json({ reply: 'サーバーでエラーが発生しました' });
  }
});

app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  console.log(`Serving root index from: ${filePath}`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error sending index.html:', err);
      res.status(500).send('Push server running');
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on 0.0.0.0:${PORT}`));
