// functions/api/sfx-names.js

// 1. 获取音效自定义名称
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const list = await env.SFX_NAMES.list();
    const namesMap = {};
    await Promise.all(
      list.keys.map(async (keyObj) => {
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

// 2. 保存音效自定义名称并实时广播
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

    // 🚀 核心：向全球实时 PubSub 广播频道推送事件（免配置、零延迟、永不断连）
    try {
      await fetch('https://ntfy.sh/tanki_sfx_sync_live_prod', {
        method: 'POST',
        headers: {
          'Title': 'SFX Rename',
          'Tags': 'sound,tanki',
        },
        body: JSON.stringify({ type: 'rename', id, name: trimmedName })
      });
    } catch (pushErr) {
      console.warn('Real-time broadcast failed:', pushErr);
    }

    return new Response(JSON.stringify({ success: true, id, name: trimmedName }), {
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
