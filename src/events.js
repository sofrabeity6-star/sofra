'use strict';
// قناة أحداث لحظية (Server-Sent Events): الأدمن يرى الطلبات والإيصالات فور وصولها، والعميل يرى تغيّر حالة طلبه.
function createHub() {
  const clients = new Set();
  const timer = setInterval(() => {
    for (const c of clients) c.res.write(': ping\n\n');
  }, 25000);
  timer.unref();

  function add(req, res, user) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client = { res, user };
    clients.add(client);
    req.on('close', () => clients.delete(client));
    return client;
  }

  function send(filter, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) if (filter(c.user)) c.res.write(payload);
  }

  return {
    add,
    toStaff: (event, data) => send((u) => u.role === 'admin' || u.role === 'staff', event, data),
    toUser: (userId, event, data) => send((u) => u.id === userId, event, data),
    size: () => clients.size,
    close: () => { clearInterval(timer); for (const c of clients) c.res.end(); clients.clear(); },
  };
}
module.exports = { createHub };
