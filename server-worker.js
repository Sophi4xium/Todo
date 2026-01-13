self.addEventListener('install', function(event) {
  console.log('[sw] install');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[sw] activate');
  event.waitUntil((async () => { try { await clients.claim(); } catch(e){} })());
});

self.addEventListener('message', function(ev) {
  try { console.log('[sw] message', ev && ev.data); } catch(e){}
});

self.addEventListener('push', function(event) {
  console.log('[sw] push received');
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    try { data = JSON.parse(event.data.text()); } catch (e2) { data = { title: '通知', body: event.data ? event.data.text() : 'タスクの通知' }; }
  }
  const title = data.title || 'タスク通知';
  // If a task object is provided, synthesize a useful body with date/time and priority
  let bodyText = '';
  if (data.task) {
    const t = data.task;
    const date = t.date || '';
    const hh = String(t.hour || 0).padStart(2, '0');
    const mm = String(t.minute || 0).padStart(2, '0');
    bodyText = `${date} ${hh}:${mm} ${t.text || ''} \n重要度:${t.priority || ''} 難易度:${t.difficulty || ''}`;
  } else {
    bodyText = data.body || '';
  }
  const options = {
    body: bodyText,
    icon: data.icon || '',
    // include structured data so notificationclick can act on taskId
    data: { url: data.url || '/', taskId: (data.task && data.task.id) || null },
    badge: data.badge || '',
    actions: data.actions || []
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const ndata = event.notification.data || {};
  // If an action button was clicked, open the app with query params indicating the action
  if (event.action) {
    const action = event.action; // e.g., 'mark_done' or 'mark_failed'
    const taskId = ndata.taskId || '';
    const url = `${ndata.url || '/'}?taskAction=${encodeURIComponent(action)}&taskId=${encodeURIComponent(taskId)}&ts=${Date.now()}`;
    // Try to handle the action in background by POSTing to server so the user does not need the app open
    event.waitUntil((async () => {
      // Notify any open client pages first so they can update UI immediately
      try {
        const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (let i = 0; i < windowClients.length; i++) {
          try { windowClients[i].postMessage({ type: 'notificationAction', action, taskId }); } catch(e){}
        }
      } catch(e){}
      try {
        // Attempt to POST the action to the server-side endpoint. If that fails, fall back to opening the app.
        await fetch('/recordAction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: taskId, action: action, ts: Date.now() })
        });
        // handled in background
        return;
      } catch (e) {
        // If background recording failed (network or CORS), try to focus or open the client so the app can record
        try {
          const windowClients = await clients.matchAll({ type: 'window' });
          for (let i = 0; i < windowClients.length; i++) {
            const client = windowClients[i];
            try { if ('focus' in client) { client.focus(); client.navigate(url); return; } } catch(e){}
          }
          if (clients.openWindow) return clients.openWindow(url);
        } catch (ee) { }
      }
    })());
    return;
  }

  // Default click (not an action) - open stored url
  // For platforms that don't support action buttons (e.g. iOS Safari), prefer to postMessage
  // to any open clients so they can show a prompt; if none open, open the app with params.
  const taskId = ndata.taskId || '';
  const openUrl = `${ndata.url || '/'}?openAction=prompt&taskId=${encodeURIComponent(taskId)}&ts=${Date.now()}`;
  event.waitUntil((async () => {
    try {
      const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windowClients && windowClients.length > 0) {
        for (let i = 0; i < windowClients.length; i++) {
          try { windowClients[i].postMessage({ type: 'notificationOpen', taskId }); } catch(e){}
        }
        return;
      }
    } catch(e){}
    try {
      const windowClients = await clients.matchAll({ type: 'window' });
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        try { if ('focus' in client) { client.focus(); client.navigate(openUrl); return; } } catch(e){}
      }
      if (clients.openWindow) return clients.openWindow(openUrl);
    } catch(e){}
  })());
});
