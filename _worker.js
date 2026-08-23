// _worker.js

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

    // 路由 A: SSE 服务器主动推送流
    if (url.pathname === '/api/sfx-stream') {
      let lang = (url.searchParams.get('lang') || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';
      const syncKey = `__LAST_UPDATE_${lang.toUpperCase()}__`;

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // 监听客户端关闭页面
      request.signal.addEventListener('abort', () => {
        try { writer.close(); } catch (e) {}
      });

      // 维持推送流
      (async () => {
        try {
          let lastTs = Date.now();
          await writer.write(encoder.encode(`event: open\ndata: {"status":"connected"}\n\n`));

          // 持续监听 60 秒
          for (let i = 0; i < 60; i++) {
            if (request.signal.aborted) break;
            await new Promise(r => setTimeout(r, 1000));
            if (request.signal.aborted) break;

            // 每 15 秒发送一次轻量心跳保活，防止 HTTP/3 (QUIC) 协议超时报警
            if (i % 15 === 0) {
              await writer.write(encoder.encode(`: ping\n\n`));
            }

            const latest = await env.SFX_NAMES.get(syncKey);
            if (latest) {
              try {
                const updateData = JSON.parse(latest);
                if (updateData.ts > lastTs) {
                  lastTs = updateData.ts;
                  const payload = JSON.stringify({
                    type: 'sfx_update',
                    id: updateData.id,
                    name: updateData.name,
                    lang: updateData.lang || lang,
                    ts: updateData.ts
                  });
                  await writer.write(encoder.encode(`data: ${payload}\n\n`));
                }
              } catch (e) {}
            }
          }
        } catch (err) {
          // 忽略正常断开
        } finally {
          try { await writer.close(); } catch (e) {}
        }
      })();

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 路由 B: 获取音效名称列表 (GET)
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

        // 写入版本变更通知
        const syncKey = `__LAST_UPDATE_${lang.toUpperCase()}__`;
        await env.SFX_NAMES.put(syncKey, JSON.stringify({
          id,
          name: trimmed,
          lang,
          ts: Date.now()
        }));

        return new Response(JSON.stringify({ success: true, id, name: trimmed, lang }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 默认返回静态页面
    return env.ASSETS.fetch(request);
  }
};
