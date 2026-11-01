// ============ 软 404 修正 ============
// Cloudflare Pages 因为仓库里没有 404.html，把本站判定成了单页应用（SPA）：
// 任何匹配不到文件的路径，env.ASSETS.fetch() 都会返回 200 + /index.html 的内容，
// 也就是「软 404」—— 缺失的图标、失效的链接统统返回首页，
// 浏览器和搜索引擎都收不到任何错误信号。
// 下面把这种兜底响应识别出来，改成返回「空 body + 404 状态码」，
// 浏览器收到后就会显示自己的原生 404 错误页（本项目不提供任何自定义 404 页面）。

let INDEX_FINGERPRINT = null;

// 取一次首页内容作为指纹（只记长度 + 前 512 字符，避免每次全量比对）
async function getIndexFingerprint(env, baseUrl) {
  if (INDEX_FINGERPRINT !== null) return INDEX_FINGERPRINT;
  const res = await env.ASSETS.fetch(new Request(new URL('/index.html', baseUrl).href));
  const text = await res.text();
  INDEX_FINGERPRINT = { len: text.length, head: text.slice(0, 512) };
  return INDEX_FINGERPRINT;
}

// 以 identity 编码请求，保证读到的 body 是明文
function plainRequest(request) {
  const headers = new Headers(request.headers);
  headers.set('accept-encoding', 'identity');
  return new Request(request.url, { method: request.method, headers, redirect: 'manual' });
}

async function serveAssetOr404(request, env) {
  if (request.method !== 'GET') return env.ASSETS.fetch(request);

  const path = new URL(request.url).pathname;
  const res = await env.ASSETS.fetch(plainRequest(request));

  // 首页本身不算兜底；非 HTML 响应（图片/字体/JSON 等）不参与判断
  if (path === '/' || path === '/index.html') return res;
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;

  // 读副本做判断：命中兜底才替换响应，否则原封不动返回（不影响任何正常页面）
  const body = await res.clone().text();
  const fp = await getIndexFingerprint(env, request.url);
  const isFallback = body.length === fp.len && body.slice(0, 512) === fp.head;

  return isFallback ? new Response(null, { status: 404 }) : res;
}

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

    // 宣传视频接口：保留其他所有现有路由。
    if (url.pathname === '/api/promo-videos') {
      return handlePromoVideos(request, env);
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

    // 静态资源：顺带修正 Pages 的 SPA 兜底（软 404）
    return await serveAssetOr404(request, env);
  }
};

// ============ 宣传视频：只访问环境变量中指定的公开文件夹 ============
// 密钥与文件夹 ID 均通过 Cloudflare Variables and Secrets 配置，不写入仓库。
const PROMO_DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

function promoJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function promoDriveGet(url, apiKey) {
  // 密钥放请求头，不放 URL，避免泄露在 URL 日志中。
  return fetch(url, { headers: { 'x-goog-api-key': apiKey } });
}

async function promoList(apiKey, folderId) {
  let pageToken = '';
  const videos = [];
  for (let page = 0; page < 20; page++) {
    const url = new URL(PROMO_DRIVE_API);
    url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await promoDriveGet(url, apiKey);
    if (!response.ok) {
      console.error('Promo Drive listing failed, HTTP', response.status);
      return promoJson({ error: `Google Drive 列表请求失败（HTTP ${response.status}）。请检查 API Key、Drive API 和文件夹共享权限。` }, 502);
    }
    const data = await response.json();
    for (const file of data.files || []) {
      if (typeof file.id !== 'string' || typeof file.name !== 'string' || !file.mimeType?.startsWith('video/')) continue;
      videos.push({ id: file.id, name: file.name.replace(/\.[^.]+$/, '') });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) {
      videos.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
      return promoJson({ videos });
    }
  }
  return promoJson({ error: '文件过多，无法在一次请求中列出全部文件。' }, 502);
}

async function promoVideo(request, apiKey, folderId, fileId) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId || '')) return promoJson({ error: '无效的视频 ID。' }, 400);
  const metadataUrl = new URL(`${PROMO_DRIVE_API}/${encodeURIComponent(fileId)}`);
  metadataUrl.searchParams.set('fields', 'id,mimeType,parents,trashed');
  metadataUrl.searchParams.set('supportsAllDrives', 'true');
  const metadataResponse = await promoDriveGet(metadataUrl, apiKey);
  if (metadataResponse.status === 404) return promoJson({ error: '视频不存在或无权访问。' }, 404);
  if (!metadataResponse.ok) {
    console.error('Promo Drive metadata failed, HTTP', metadataResponse.status);
    return promoJson({ error: '无法读取视频信息，请检查 Google Drive API 和共享权限。' }, 502);
  }
  const file = await metadataResponse.json();
  if (file.trashed || !file.parents?.includes(folderId) || !file.mimeType?.startsWith('video/')) {
    return promoJson({ error: '视频不在指定文件夹中。' }, 404);
  }
  const range = request.headers.get('Range');
  if (range && (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-')) {
    return new Response('Unsupported Range', { status: 416 });
  }
  const headers = new Headers();
  if (range) headers.set('Range', range);
  const url = new URL('https://drive.usercontent.google.com/download');
  url.searchParams.set('id', fileId);
  url.searchParams.set('export', 'download');
  url.searchParams.set('confirm', 't');
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (response.status === 416) {
    const h = new Headers();
    const cr = response.headers.get('Content-Range');
    if (cr) h.set('Content-Range', cr);
    return new Response(null, { status: 416, headers: h });
  }
  if (response.status !== 200 && response.status !== 206) {
    return promoJson({ error: `Google Drive 下载失败（HTTP ${response.status}）。` }, 502);
  }
  if ((response.headers.get('Content-Type') || '').toLowerCase().includes('text/html')) {
    return promoJson({ error: 'Google Drive 返回网页而非视频。请检查共享权限、下载限制和流量配额。' }, 502);
  }
  const out = new Headers();
  for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const value = response.headers.get(key);
    if (value) out.set(key, value);
  }
  out.set('Content-Type', file.mimeType);
  out.set('Content-Disposition', 'inline');
  out.set('X-Content-Type-Options', 'nosniff');
  out.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers: out });
}

async function handlePromoVideos(request, env) {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
  const apiKey = env.GOOGLE_DRIVE_API_KEY;
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID;
  if (!apiKey || !folderId) return promoJson({ error: '请在 Cloudflare 中配置 GOOGLE_DRIVE_API_KEY 和 GOOGLE_DRIVE_FOLDER_ID。' }, 500);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(folderId)) return promoJson({ error: 'Google Drive 文件夹 ID 格式无效。' }, 500);
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('action') === 'list') return await promoList(apiKey, folderId);
    if (url.searchParams.get('action') === 'video') return await promoVideo(request, apiKey, folderId, url.searchParams.get('id'));
    return promoJson({ error: '未知操作。' }, 400);
  } catch (error) {
    // 不记录请求 URL 或密钥。
    console.error('Promo proxy network or parsing error');
    return promoJson({ error: '访问 Google Drive 时发生错误。' }, 502);
  }
}
