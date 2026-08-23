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

    // 路由 A: SSE 服务器主动推送流 (Server-Sent Events 长连接)
    if (url.pathname === '/api/sfx-stream') {
      let lang = (url.searchParams.get('lang') || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';
      const syncKey = `__LAST_UPDATE_${lang.toUpperCase()}__`;

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // 在后台维持长连接并主动推流
      (async () => {
        try {
          let lastTs = Date.now();
          // 发送连接建立事件
          await writer.write(encoder.encode(`event: open\ndata: {"status":"connected"}\n\n`));

          // 保持长连接 45 秒（超时后浏览器 EventSource 会自动无缝重连）
          for (let i = 0; i < 45; i++) {
            await new Promise(r => setTimeout(r, 1000));
            
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
                  // 服务器主动向客户端推送数据
                  await writer.write(encoder.encode(`data: ${payload}\n\n`));
                }
              } catch (e) {}
            }
          }
          await writer.close();
        } catch (err) {
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

        // 写入版本变更通知，供 SSE 长连接推流
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

    // 默认返回静态页面 (index.html 等)
    return env.ASSETS.fetch(request);
  }
};
