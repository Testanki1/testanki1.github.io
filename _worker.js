// _worker.js

// 1. 广播中枢 Durable Object 类 (完全免费且支持 SQLite)
export class SfxHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 内部广播路由
    if (url.pathname.endsWith('/broadcast')) {
      const payload = await request.text();
      for (const ws of this.sessions) {
        try {
          ws.send(payload);
        } catch (err) {
          this.sessions.delete(ws);
        }
      }
      return new Response(JSON.stringify({ success: true }));
    }

    // WebSocket 握手
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.sessions.add(server);

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ping') server.send(JSON.stringify({ type: 'pong' }));
      } catch (e) {}
    });

    server.addEventListener('close', () => this.sessions.delete(server));
    server.addEventListener('error', () => this.sessions.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }
}

// 2. 主请求分发 (处理 API、WebSocket 以及静态 HTML 页面)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 跨域预检处理
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 路由 A: WebSocket 实时连接
    if (url.pathname === '/api/sfx-ws') {
      const id = env.SFX_HUB.idFromName('GLOBAL_SFX_HUB');
      const hub = env.SFX_HUB.get(id);
      return hub.fetch(request);
    }

    // 路由 B: 获取音效名称 (GET)
    if (url.pathname === '/api/sfx-names' && request.method === 'GET') {
      let lang = (url.searchParams.get('lang') || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';
      const prefix = `${lang}:`;
      const list = await env.SFX_NAMES.list({ prefix });
      const namesMap = {};
      await Promise.all(
        list.keys.map(async (k) => {
          const sfxId = k.name.slice(prefix.length);
          const val = await env.SFX_NAMES.get(k.name);
          if (val) namesMap[sfxId] = val;
        })
      );
      return new Response(JSON.stringify(namesMap), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 路由 C: 保存名称并触发全网推送 (POST)
    if (url.pathname === '/api/sfx-names' && request.method === 'POST') {
      try {
        const body = await request.json();
        let { id, name, lang } = body;
        if (!id) return new Response(JSON.stringify({ error: 'Missing ID' }), { status: 400 });

        lang = (lang || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';
        const trimmed = (name || '').trim();
        const kvKey = `${lang}:${id}`;

        if (trimmed) {
          await env.SFX_NAMES.put(kvKey, trimmed.slice(0, 40));
        } else {
          await env.SFX_NAMES.delete(kvKey);
        }

        // 推送给 DO 广播中枢
        if (env.SFX_HUB) {
          const hubId = env.SFX_HUB.idFromName('GLOBAL_SFX_HUB');
          const hub = env.SFX_HUB.get(hubId);
          await hub.fetch('https://internal/broadcast', {
            method: 'POST',
            body: JSON.stringify({ type: 'sfx_update', id, name: trimmed, lang, ts: Date.now() })
          });
        }

        return new Response(JSON.stringify({ success: true, id, name: trimmed }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 默认返回静态资源 (index.html, assets.json 等)
    return env.ASSETS.fetch(request);
  }
};
