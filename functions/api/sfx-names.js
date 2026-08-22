// functions/api/sfx-names.js

// 1. 获取对应语言的所有自定义名称（内置旧中文数据自动迁移）
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    let lang = (url.searchParams.get('lang') || 'zh').toLowerCase();
    if (lang !== 'en') lang = 'zh';

    const list = await env.SFX_NAMES.list();
    const namesMap = {};

    await Promise.all(
      list.keys.map(async (keyObj) => {
        const rawKey = keyObj.name;
        // 忽略版本同步键
        if (rawKey.startsWith('__LAST_UPDATE')) return;

        // 🚀 【自动迁移逻辑】：如果 key 不包含冒号，属于之前的旧中文数据
        if (!rawKey.includes(':')) {
          const oldVal = await env.SFX_NAMES.get(rawKey);
          if (oldVal) {
            // 自动迁移保存为 zh:ID
            await env.SFX_NAMES.put(`zh:${rawKey}`, oldVal);
            // 删除无前缀旧键
            await env.SFX_NAMES.delete(rawKey);
            // 如果当前正在请求中文，直接载入
            if (lang === 'zh') {
              namesMap[rawKey] = oldVal;
            }
          }
          return;
        }

        // 正常多语言前缀读取: zh:ID 或 en:ID
        const targetPrefix = `${lang}:`;
        if (rawKey.startsWith(targetPrefix)) {
          const sfxId = rawKey.slice(targetPrefix.length);
          const val = await env.SFX_NAMES.get(rawKey);
          if (val) namesMap[sfxId] = val;
        }
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

// 2. 保存指定语言的音效名称并更新对应语言的增量版本
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

    if (trimmedName) {
      await env.SFX_NAMES.put(kvKey, trimmedName.slice(0, 40));
    } else {
      await env.SFX_NAMES.delete(kvKey);
    }

    // 记录对应语言的增量更新版本日志
    try {
      const syncKey = `__LAST_UPDATE_${lang.toUpperCase()}__`;
      let lastObj = { ts: Date.now(), history: [] };
      const raw = await env.SFX_NAMES.get(syncKey);
      if (raw) {
        try { lastObj = JSON.parse(raw); } catch(e) {}
      }

      const newEntry = { id, name: trimmedName, ts: Date.now() };
      lastObj.ts = newEntry.ts;
      lastObj.history = [newEntry, ...(lastObj.history || [])].slice(0, 30);

      await env.SFX_NAMES.put(syncKey, JSON.stringify(lastObj));
    } catch (verErr) {
      console.warn('记录版本失败:', verErr);
    }

    return new Response(JSON.stringify({ success: true, id, name: trimmedName, lang, ts: Date.now() }), {
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
