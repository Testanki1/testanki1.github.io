// functions/api/sfx-names.js

// 1. 获取所有音效自定义名称
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const list = await env.SFX_NAMES.list();
    const namesMap = {};
    await Promise.all(
      list.keys.map(async (keyObj) => {
        // 忽略内部增量版本同步键
        if (keyObj.name === '__LAST_UPDATE__') return;
        const val = await env.SFX_NAMES.get(keyObj.name);
        if (val) namesMap[keyObj.name] = val;
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

// 2. 保存音效自定义名称并记录实时增量版本
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { id, name } = body;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const trimmedName = (name || '').trim();
    if (trimmedName) {
      await env.SFX_NAMES.put(id, trimmedName.slice(0, 40));
    } else {
      await env.SFX_NAMES.delete(id);
    }

    // 🚀 记录全球增量版本日志，供所有客户端实时同步
    try {
      let lastObj = { ts: Date.now(), history: [] };
      const raw = await env.SFX_NAMES.get('__LAST_UPDATE__');
      if (raw) {
        try { lastObj = JSON.parse(raw); } catch(e) {}
      }

      const newEntry = { id, name: trimmedName, ts: Date.now() };
      lastObj.ts = newEntry.ts;
      lastObj.history = [newEntry, ...(lastObj.history || [])].slice(0, 30); // 保留最近 30 条修改记录

      await env.SFX_NAMES.put('__LAST_UPDATE__', JSON.stringify(lastObj));
    } catch (verErr) {
      console.warn('记录版本失败:', verErr);
    }

    return new Response(JSON.stringify({ success: true, id, name: trimmedName, ts: Date.now() }), {
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
