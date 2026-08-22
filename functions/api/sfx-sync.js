// functions/api/sfx-sync.js

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const since = parseInt(url.searchParams.get('since') || '0', 10);

    const latest = await env.SFX_NAMES.get('__LAST_UPDATE__');
    if (latest) {
      const updateData = JSON.parse(latest);
      if (updateData.ts > since) {
        const changes = (updateData.history || []).filter(item => item.ts > since);
        return new Response(JSON.stringify({
          changed: true,
          ts: updateData.ts,
          changes: changes.length > 0 ? changes : [{ id: updateData.id, name: updateData.name, ts: updateData.ts }]
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    return new Response(JSON.stringify({ changed: false }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ changed: false, error: err.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
