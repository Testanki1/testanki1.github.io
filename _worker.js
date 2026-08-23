export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 路由 A: WebSocket 实时连接 (国内访客通过 pages.dev 接入)
    if (url.pathname === '/api/sfx-ws') {
      const id = env.SFX_HUB.idFromName('GLOBAL_SFX_HUB');
      const hub = env.SFX_HUB.get(id);
      return hub.fetch(request);
    }

    // 路由 B: 获取名称 (GET)
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

    // 路由 C: 保存名称并触发全网毫秒级推送 (POST)
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

        // 核心：直接调用 Durable Object 进行内存级 WebSocket 广播 (耗时仅 10ms！)
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

    return env.ASSETS.fetch(request);
  }
};
