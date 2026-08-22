// functions/api/sfx-events.js

// 全局维护在线活跃的客户端连接
const clients = new Set();

export async function onRequestGet(context) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // 1. 发送建立连接确认消息
  writer.write(encoder.encode(`event: connected\ndata: {"status":"connected"}\n\n`));

  const client = { writer, encoder };
  clients.add(client);

  // 2. 发送定时心跳维持长连接 (每 25 秒)
  const heartbeat = setInterval(() => {
    writer.write(encoder.encode(`: ping\n\n`)).catch(() => {
      clearInterval(heartbeat);
      clients.delete(client);
    });
  }, 25000);

  // 3. 客户端页面关闭/断开时清理
  context.request.signal.addEventListener('abort', () => {
    clearInterval(heartbeat);
    clients.delete(client);
    try {
      writer.close();
    } catch (e) {}
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    },
  });
}

// 供保存接口调用的即时广播方法
export function broadcastRename(id, name) {
  const payload = JSON.stringify({ type: 'rename', id, name });
  const msg = `event: message\ndata: ${payload}\n\n`;
  for (const client of clients) {
    client.writer.write(client.encoder.encode(msg)).catch(() => {
      clients.delete(client);
    });
  }
}
