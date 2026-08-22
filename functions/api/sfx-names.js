// functions/api/sfx-names.js

// 1. 获取指定语言的所有自定义名称
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    let lang = (url.searchParams.get('lang') || 'zh').toLowerCase();
    if (lang !== 'en') lang = 'zh';

    const prefix = `${lang}:`;
    const list = await env.SFX_NAMES.list({ prefix });
    const namesMap = {};

    await Promise.all(
      list.keys.map(async (keyObj) => {
        const rawKey = keyObj.name;
        const sfxId = rawKey.slice(prefix.length);
        const val = await env.SFX_NAMES.get(rawKey);
        if (val) namesMap[sfxId] = val;
      })
    );

    return new Response(JSON.stringify(namesMap), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// 2. 保存指定语言的音效名称并向所有在线客户端广播
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    let { id, name, lang } = body;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    lang = (lang || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';
    const trimmedName = (name || '').trim();
    const kvKey = `${lang}:${id}`;

    // 写入 / 删除 KV
    if (trimmedName) {
      await env.SFX_NAMES.put(kvKey, trimmedName.slice(0, 40));
    } else {
      await env.SFX_NAMES.delete(kvKey);
    }

    // 核心推送：触发 Durable Object 全网毫秒级广播
    try {
      if (env.SFX_HUB) {
        const hubId = env.SFX_HUB.idFromName('GLOBAL_SFX_HUB');
        const hubObject = env.SFX_HUB.get(hubId);

        await hubObject.fetch('https://hub.internal/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'sfx_update',
            id,
            name: trimmedName,
            lang,
            ts: Date.now()
          })
        });
      }
    } catch (pushErr) {
      console.warn('广播推送失败:', pushErr);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      id, 
      name: trimmedName, 
      lang, 
      ts: Date.now() 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
