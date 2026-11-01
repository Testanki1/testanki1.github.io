// 仅代理本页面的视频请求；直接流式转发，并报告实际传输字节速率。
// 不保存视频、API Key 或文件夹 ID，也不发起额外测速下载。
const ROUTE = '/videos/__stream';
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', event => {
  const incoming = new URL(event.request.url);
  if (incoming.origin !== self.location.origin || incoming.pathname !== ROUTE || event.request.method !== 'GET') return;
  const id = incoming.searchParams.get('id') || '';
  const session = incoming.searchParams.get('session') || '';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !/^[A-Za-z0-9_-]{1,120}$/.test(session)) {
    event.respondWith(new Response('Invalid request', {status: 400})); return;
  }
  const send = async message => {
    try {
      if (event.clientId) {
        const client = await self.clients.get(event.clientId);
        if (client) { client.postMessage({type:'promo-transfer', session, ...message}); return; }
      }
      // 某些浏览器对媒体请求没有 clientId，回传给受控页面并由 session 过滤。
      const clients = await self.clients.matchAll({type:'window', includeUncontrolled:false});
      for (const client of clients) client.postMessage({type:'promo-transfer', session, ...message});
    } catch { /* 数据传输不能因为状态消息失败而中断。 */ }
  };
  event.respondWith((async () => {
    const url = new URL('/api/promo-videos', self.location.origin);
    url.searchParams.set('action','video'); url.searchParams.set('id',id);
    const headers = new Headers();
    const range = event.request.headers.get('Range');
    if (range) headers.set('Range',range);
    const response = await fetch(url.toString(), {method:'GET', headers, cache:'no-store', signal:event.request.signal});
    if (!response.body || (response.status !== 200 && response.status !== 206)) return response;
    const reader = response.body.getReader();
    let bytes = 0, start = performance.now();
    const report = force => {
      const now = performance.now(), elapsed = now - start;
      if (bytes > 0 && (elapsed >= 500 || force)) {
        void send({event:'speed', bytesPerSecond:bytes * 1000 / Math.max(1, elapsed)});
        bytes = 0; start = now;
      }
    };
    void send({event:'start'});
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) { report(true); controller.close(); void send({event:'done'}); return; }
          bytes += part.value.byteLength; report(false); controller.enqueue(part.value);
        } catch (error) { controller.error(error); void send({event:'error'}); }
      },
      cancel(reason) { void send({event:'done'}); return reader.cancel(reason); },
    });
    return new Response(body, {status:response.status, statusText:response.statusText, headers:response.headers});
  })());
});
