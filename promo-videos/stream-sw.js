// 只代理本页面的视频请求，统计已传输字节，并支持按播放会话取消。
// 不缓存视频、不发起额外测速下载；每次实际播放只使用原有视频请求。
const ROUTE = '/promo-videos/__stream';
const VIDEO_API_ORIGIN = self.location.hostname === 'testanki1.github.io' ? 'https://testanki1.pages.dev' : self.location.origin;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const streams = new Map();
const cancelled = new Map();
const CANCEL_TTL_MS = 30000;

self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

function pruneCancelled() {
  const now = Date.now();
  for (const [session, expiry] of cancelled) if (expiry <= now) cancelled.delete(session);
}
function track(session, job) {
  if (!streams.has(session)) streams.set(session, new Set());
  streams.get(session).add(job);
}
function untrack(session, job) {
  const jobs = streams.get(session);
  if (!jobs) return;
  jobs.delete(job);
  if (!jobs.size) streams.delete(session);
}
function stopJob(job, reason) {
  if (job.stopped) return;
  job.stopped = true;
  job.controller.abort();
  if (job.reader) void job.reader.cancel(reason).catch(() => {});
  job.finish();
}
self.addEventListener('message', event => {
  const data = event.data;
  if (data?.type !== 'promo-cancel' || !SESSION_PATTERN.test(data.session || '')) return;
  pruneCancelled();
  // 短时间记住已关闭会话，防止取消消息先于媒体请求抵达时重新启动下载。
  cancelled.set(data.session, Date.now() + CANCEL_TTL_MS);
  const jobs = streams.get(data.session);
  if (jobs) for (const job of [...jobs]) stopJob(job, 'Player closed');
});

self.addEventListener('fetch', event => {
  const incoming = new URL(event.request.url);
  if (incoming.origin !== self.location.origin || incoming.pathname !== ROUTE || event.request.method !== 'GET') return;
  const id = incoming.searchParams.get('id') || '';
  const session = incoming.searchParams.get('session') || '';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !SESSION_PATTERN.test(session)) {
    event.respondWith(new Response('Invalid request', {status:400})); return;
  }
  pruneCancelled();
  if (cancelled.has(session)) {
    event.respondWith(new Response(null, {status:204})); return;
  }
  const send = async message => {
    try {
      if (event.clientId) {
        const client = await self.clients.get(event.clientId);
        if (client) { client.postMessage({type:'promo-transfer', session, ...message}); return; }
      }
      const clients = await self.clients.matchAll({type:'window', includeUncontrolled:false});
      for (const client of clients) client.postMessage({type:'promo-transfer', session, ...message});
    } catch { /* 状态消息不能影响数据传输。 */ }
  };
  const job = {controller:new AbortController(), reader:null, stopped:false, finished:false, finish:null};
  const onAbort = () => stopJob(job, 'Request cancelled');
  job.finish = () => {
    if (job.finished) return;
    job.finished = true;
    event.request.signal.removeEventListener('abort', onAbort);
    untrack(session, job);
  };
  track(session, job);
  if (event.request.signal.aborted) stopJob(job, 'Request cancelled');
  else event.request.signal.addEventListener('abort', onAbort, {once:true});
  event.respondWith((async () => {
    try {
      if (job.stopped) return new Response(null, {status:204});
      const url = new URL('/api/promo-videos', VIDEO_API_ORIGIN);
      url.searchParams.set('action','video'); url.searchParams.set('id',id);
      const headers = new Headers();
      const range = event.request.headers.get('Range');
      if (range) headers.set('Range',range);
      const response = await fetch(url.toString(), {method:'GET', headers, cache:'no-store', signal:job.controller.signal});
      if (job.stopped) { if (response.body) void response.body.cancel().catch(() => {}); return new Response(null, {status:204}); }
      if (!response.body || (response.status !== 200 && response.status !== 206)) { job.finish(); return response; }
      const reader = job.reader = response.body.getReader();
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
          if (job.stopped) { try { controller.close(); } catch {} return; }
          try {
            const part = await reader.read();
            if (job.stopped) { try { controller.close(); } catch {} return; }
            if (part.done) { report(true); controller.close(); job.finish(); void send({event:'done'}); return; }
            bytes += part.value.byteLength; report(false); controller.enqueue(part.value);
          } catch (error) {
            job.finish();
            if (job.stopped) { try { controller.close(); } catch {} }
            else { controller.error(error); void send({event:'error'}); }
          }
        },
        cancel(reason) { stopJob(job, reason); },
      });
      return new Response(body, {status:response.status, statusText:response.statusText, headers:response.headers});
    } catch (error) {
      job.finish();
      if (job.stopped) return new Response(null, {status:204});
      throw error;
    }
  })());
});
