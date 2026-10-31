import { CHANNELS, runSync, loadState, loadBlocks, saveBlocks, allEvents, blockedRangesFor } from './sync.js';
import { buildICS, todayJST } from './ical.js';
import { renderPage } from './ui.js';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    return safeEqual(decoded.slice(decoded.indexOf(':') + 1), env.ADMIN_PASSWORD);
  } catch {
    return false;
  }
}

const redirect = (msg) =>
  new Response(null, { status: 303, headers: { Location: msg ? `/?msg=${encodeURIComponent(msg)}` : '/' } });

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

async function handleExport(env, channel, token) {
  if (!safeEqual(token, env.EXPORT_TOKEN) || !CHANNELS.some((c) => c.id === channel)) {
    return new Response('Not found', { status: 404 });
  }
  const [state, blocks] = await Promise.all([loadState(env), loadBlocks(env)]);
  const ranges = blockedRangesFor(channel, allEvents(state, blocks), todayJST());
  return new Response(buildICS(ranges, { calName: `minpaku-sync for ${channel}` }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleAdmin(request, env, url) {
  if (request.method === 'POST') {
    // 他サイトからのフォーム送信を防ぐ
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });

    if (url.pathname === '/sync') {
      await runSync(env);
      return redirect('同期しました');
    }
    if (url.pathname === '/blocks') {
      const form = await request.formData();
      const start = form.get('start'), end = form.get('end');
      if (!isDate(start) || !isDate(end) || end <= start) return redirect('終了日は開始日より後にしてください');
      const blocks = await loadBlocks(env);
      blocks.push({ id: crypto.randomUUID(), start, end, note: String(form.get('note') || '').slice(0, 50) });
      await saveBlocks(env, blocks);
      return redirect('ブロックしました（各サイトへの反映には数時間かかることがあります）');
    }
    if (url.pathname === '/blocks/delete') {
      const form = await request.formData();
      const blocks = await loadBlocks(env);
      await saveBlocks(env, blocks.filter((b) => b.id !== form.get('id')));
      return redirect('ブロックを削除しました');
    }
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname !== '/') return new Response('Not found', { status: 404 });
  const [state, blocks] = await Promise.all([loadState(env), loadBlocks(env)]);
  const html = renderPage({ state, blocks, origin: url.origin, token: env.EXPORT_TOKEN, flash: url.searchParams.get('msg') || '' });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    if (!env.ADMIN_PASSWORD || !env.EXPORT_TOKEN) {
      return new Response('ADMIN_PASSWORD と EXPORT_TOKEN を設定してください（README参照）', { status: 500 });
    }
    const url = new URL(request.url);
    const m = /^\/ical\/([^/]+)\/([a-z]+)\.ics$/.exec(url.pathname);
    if (m && request.method === 'GET') return handleExport(env, m[2], m[1]);

    if (!authorized(request, env)) {
      return new Response('ログインが必要です', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="minpaku-sync", charset="UTF-8"' },
      });
    }
    return handleAdmin(request, env, url);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};
