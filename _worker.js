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

    // 路由 D: 通用 CORS 代理（ratings.html 排行榜/玩家数据用）
    // 用法: /proxy?<encodeURIComponent(目标URL)>
    //      或 /proxy?url=<encodeURIComponent(目标URL)>
    if (url.pathname === '/proxy') {
      const PROXY_ALLOWED_HOSTS = ['.tankionline.com', '.3dtank.com'];

      const jsonError = (message, status) =>
        new Response(JSON.stringify({ error: message }), {
          status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });

      // 目标地址两种传法：?url=xxx 或整段 encodeURIComponent 编码
      let target = url.searchParams.get('url');
      if (!target && url.search.length > 1) {
        const raw = url.search.slice(1);
        try { target = decodeURIComponent(raw); } catch { target = raw; }
      }
      if (!target) return jsonError('缺少目标地址：使用 /proxy?<encodeURIComponent(目标URL)>', 400);

      let targetUrl;
      try { targetUrl = new URL(target); } catch { return jsonError(`目标地址无效: ${target}`, 400); }
      if (!/^https?:$/.test(targetUrl.protocol)) return jsonError('仅支持 http/https 协议', 400);

      // 域名白名单，防止代理被滥用（如需代理任意网址，把数组清空为 []）
      const allowed = PROXY_ALLOWED_HOSTS.some(
        (s) => targetUrl.hostname === s.slice(1) || targetUrl.hostname.endsWith(s)
      );
      if (!allowed) return jsonError(`目标域名不在白名单内: ${targetUrl.hostname}`, 403);

      // 干净请求头转发（不转发浏览器的 Origin/Referer，避免被目标站拦截）
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      };
      const init = {
        method: ['GET', 'HEAD', 'POST'].includes(request.method) ? request.method : 'GET',
        headers,
        redirect: 'follow'
      };
      if (request.method === 'POST') {
        init.body = await request.arrayBuffer();
        const ct = request.headers.get('Content-Type');
        if (ct) headers['Content-Type'] = ct;
      }

      let upstream;
      try {
        upstream = await fetch(targetUrl.toString(), init);
      } catch (err) {
        return jsonError(`请求目标服务器失败: ${err.message || err}`, 502);
      }

      const respHeaders = new Headers(upstream.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      // 边缘侧已自动解压，删掉这两个头避免浏览器解析错乱
      respHeaders.delete('Content-Encoding');
      respHeaders.delete('Content-Length');
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    return env.ASSETS.fetch(request);
  }
};
