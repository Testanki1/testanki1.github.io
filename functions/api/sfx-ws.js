// functions/api/sfx-ws.js

// Durable Object 广播中枢类 (管理全网所有在线的客户端连接)
export class SfxHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 1. 处理内部广播路由（由 POST /api/sfx-names 触发）
    if (url.pathname === '/broadcast' || url.pathname.endsWith('/broadcast')) {
      const payload = await request.text();
      for (const webSocket of this.sessions) {
        try {
          webSocket.send(payload);
        } catch (err) {
          this.sessions.delete(webSocket);
        }
      }
      return new Response(JSON.stringify({ success: true, count: this.sessions.size }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. 验证 WebSocket 升级协议头
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 接入 WebSocket
    server.accept();
    this.sessions.add(server);

    // 心跳与消息处理
    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ping') {
          server.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {}
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
    });

    server.addEventListener('error', () => {
      this.sessions.delete(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}

// Pages Function 入口：客户端连接 /api/sfx-ws 时路由至全局广播 DO 实例
export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.SFX_HUB) {
    return new Response(JSON.stringify({ error: 'SFX_HUB Durable Object binding is missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const id = env.SFX_HUB.idFromName('GLOBAL_SFX_HUB');
  const hubObject = env.SFX_HUB.get(id);

  return hubObject.fetch(request);
}
