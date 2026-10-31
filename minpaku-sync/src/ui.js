import { CHANNELS, MANUAL, allEvents, findOverlaps } from './sync.js';
import { addDays, nightsBetween, todayJST } from './ical.js';

const SOURCE_LABEL = Object.fromEntries([...CHANNELS.map((c) => [c.id, c.name]), [MANUAL, '手動']]);
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtDate(d) {
  const [, m, day] = d.split('-');
  const w = WEEKDAYS[new Date(d + 'T00:00:00Z').getUTCDay()];
  return `${+m}/${+day}(${w})`;
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms + 9 * 3600 * 1000).toISOString();
  return `${+d.slice(5, 7)}/${+d.slice(8, 10)} ${d.slice(11, 16)}`;
}

const chip = (source) => `<span class="chip s-${source}">${esc(SOURCE_LABEL[source] || source)}</span>`;

function renderMonth(year, month, events, today) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = new Date(first + 'T00:00:00Z').getUTCDay();
  let cells = '<div class="cell empty"></div>'.repeat(lead);
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i);
    // その日の夜に泊まっている予約（チェックアウト日は空き扱い）
    const stays = events.filter((e) => e.start <= d && d < e.end);
    const sources = [...new Set(stays.map((e) => e.source))];
    const cls = ['cell', d < today ? 'past' : '', d === today ? 'today' : '', sources.length > 1 ? 'multi' : ''].join(' ');
    const bars = sources.map((s) => `<i class="bar s-${s}"></i>`).join('');
    const title = stays.map((e) => SOURCE_LABEL[e.source]).join(' / ');
    cells += `<div class="${cls}" title="${esc(title)}"><span>${i + 1}</span>${bars}</div>`;
  }
  return `<section class="month"><h3>${year}年${month}月</h3>
    <div class="grid">${WEEKDAYS.map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div></section>`;
}

export function renderPage({ state, blocks, origin, token, now = Date.now(), flash = '' }) {
  const today = todayJST(now);
  const events = allEvents(state, blocks);
  const overlaps = findOverlaps(events, today);
  const conflicts = overlaps.filter((o) => o.kind === 'conflict');
  const echoes = overlaps.filter((o) => o.kind === 'echo');
  const upcoming = events.filter((e) => e.end > today);

  const conflictHtml = conflicts.length
    ? `<section class="alert"><h2>⚠ ダブルブッキングの可能性</h2><ul>${conflicts
        .map((c) => `<li>${chip(c.a.source)} ${fmtDate(c.a.start)}〜${fmtDate(c.a.end)}<br>${chip(c.b.source)} ${fmtDate(c.b.start)}〜${fmtDate(c.b.end)}</li>`)
        .join('')}</ul><p>どちらかの予約サイトで予約内容を確認し、ゲストへの連絡やキャンセル対応をしてください。</p></section>`
    : `<section class="ok">✓ 重複している予約はありません</section>`;

  const syncRows = CHANNELS.map((ch) => {
    const s = state.sources?.[ch.id];
    let status;
    if (!s || !s.configured) status = '<span class="muted">未設定</span>';
    else if (s.error) status = `<span class="err">取得失敗: ${esc(s.error)}</span><br><span class="muted">前回成功 ${fmtTime(s.lastSuccessAt)}（前回の予約を保持中）</span>`;
    else status = `<span class="good">OK</span> <span class="muted">${fmtTime(s.lastSuccessAt)} ・ ${s.events.length}件</span>`;
    return `<li>${chip(ch.id)} ${status}</li>`;
  }).join('');

  const list = upcoming.length
    ? upcoming.map((e) => {
        const isEcho = echoes.some((o) => o.a === e || o.b === e);
        const del = e.source === MANUAL
          ? `<form method="post" action="/blocks/delete"><input type="hidden" name="id" value="${esc(e.uid)}"><button class="link">削除</button></form>`
          : '';
        return `<li class="${isEcho ? 'echo' : ''}"><div>${chip(e.source)} <b>${fmtDate(e.start)} → ${fmtDate(e.end)}</b> <span class="muted">${nightsBetween(e.start, e.end)}泊</span></div>
          <div class="sub">${esc(e.summary)}${isEcho ? ' <span class="muted">（他サイトの予約が同期で反映されたもの）</span>' : ''}</div>${del}</li>`;
      }).join('')
    : '<li class="muted">今後の予約はまだありません</li>';

  const [y, m] = today.split('-').map(Number);
  const months = [0, 1, 2].map((k) => {
    const mm = ((m - 1 + k) % 12) + 1;
    return renderMonth(y + Math.floor((m - 1 + k) / 12), mm, events, today);
  }).join('');

  const exportRows = CHANNELS.map((ch) => {
    const url = `${origin}/ical/${token}/${ch.id}.ics`;
    return `<li><div>${chip(ch.id)} に取り込むURL</div><div class="copy"><input readonly value="${esc(url)}"><button type="button" onclick="cp(this)">コピー</button></div></li>`;
  }).join('');

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f766e"><title>民泊予約カレンダー</title><style>${CSS}</style></head><body>
<header><h1>民泊予約カレンダー</h1><form method="post" action="/sync"><button>今すぐ同期</button></form></header>
<main>
${flash ? `<p class="flash">${esc(flash)}</p>` : ''}
${conflictHtml}
<section><h2>同期の状態</h2><ul class="plain">${syncRows}</ul><p class="muted small">最終同期 ${fmtTime(state.lastSyncAt)}（10分ごとに自動同期）</p></section>
<section><h2>カレンダー</h2><div class="legend">${[...CHANNELS.map((c) => c.id), MANUAL].map(chip).join(' ')}</div>${months}</section>
<section><h2>今後の予約・ブロック</h2><ul class="list">${list}</ul></section>
<section><h2>日付を手動でブロック</h2><p class="muted small">自分で使う日や工事の日など。全サイトで予約不可になります。</p>
<form method="post" action="/blocks" class="block-form">
<label>開始日<input type="date" name="start" required min="${today}"></label>
<label>終了日（この日は空き）<input type="date" name="end" required min="${today}"></label>
<label>メモ<input name="note" maxlength="50" placeholder="例: 清掃・点検"></label>
<button>ブロックする</button></form></section>
<section><h2>予約サイトの設定</h2><p class="muted small">各サイトの「カレンダーをインポート」にこのURLを登録してください。各サイトには<b>他の2サイトの予約と手動ブロック</b>が「予約不可」として届きます（ゲスト情報は送りません）。</p>
<ul class="plain">${exportRows}</ul></section>
</main>
<script>function cp(b){const i=b.previousElementSibling;i.select();navigator.clipboard?.writeText(i.value);b.textContent='コピー済み';setTimeout(()=>b.textContent='コピー',1500)}</script>
</body></html>`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1f2937;--muted:#6b7280;--line:#e5e7eb;--accent:#0f766e;
--airbnb:#e0484e;--booking:#1d4ed8;--agoda:#7c3aed;--manual:#6b7280;--err:#b91c1c;--good:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--text:#e5e7eb;--muted:#9ca3af;--line:#2a2f37;
--airbnb:#f87171;--booking:#60a5fa;--agoda:#a78bfa;--manual:#9ca3af;--err:#f87171;--good:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--accent);color:#fff}
header h1{font-size:17px;margin:0}header button{background:#fff;color:var(--accent)}
main{max-width:640px;margin:0 auto;padding:12px 16px 40px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
h2{font-size:16px;margin:0 0 8px}h3{font-size:14px;margin:12px 0 6px}
button{font:inherit;border:0;border-radius:8px;padding:8px 14px;background:var(--accent);color:#fff;font-weight:600}
button.link{background:none;color:var(--err);padding:4px 0;font-weight:400}
.alert{border:2px solid var(--err)}.alert h2{color:var(--err)}.alert li{margin:6px 0}
.ok{color:var(--good);font-weight:600}.flash{background:var(--card);border-left:4px solid var(--accent);padding:8px 12px;border-radius:6px}
.muted{color:var(--muted)}.small{font-size:13px}.err{color:var(--err)}.good{color:var(--good);font-weight:600}
ul{padding-left:18px;margin:0}.plain,.list{list-style:none;padding:0}.plain li{padding:8px 0;border-bottom:1px solid var(--line)}
.list li{padding:10px 0;border-bottom:1px solid var(--line)}.list li:last-child,.plain li:last-child{border-bottom:0}
.list li.echo{opacity:.6}.sub{font-size:13px;color:var(--muted);margin-top:2px}
.chip{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;color:#fff;vertical-align:1px}
.s-airbnb{background:var(--airbnb)}.s-booking{background:var(--booking)}.s-agoda{background:var(--agoda)}.s-manual{background:var(--manual)}
.legend{display:flex;gap:6px;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.wd{text-align:center;font-size:12px;color:var(--muted)}
.cell{position:relative;min-height:42px;border-radius:6px;background:var(--bg);padding:3px;font-size:12px;display:flex;flex-direction:column;gap:2px}
.cell.empty{background:none}.cell.past{opacity:.45}.cell.today{outline:2px solid var(--accent)}
.cell.multi{outline:2px solid var(--err)}.bar{display:block;height:6px;border-radius:3px}
.block-form{display:grid;gap:10px}.block-form label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
input{font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);width:100%}
.copy{display:flex;gap:6px;margin-top:4px}.copy input{font-size:12px;min-width:0}.copy button{white-space:nowrap}
`;
