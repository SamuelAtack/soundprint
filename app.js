(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const S = window.Stats;
  let lastD = null;
  const state = { all: [], year: null, strict: true, metric: 'ms', tab: 'artists', limit: 15 };

  /* ---------- tiny DOM helper (no innerHTML => user data can't inject markup) ---------- */
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'tip') e.dataset.tip = v;
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) e.style.setProperty(sk, sv);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c);
    return e;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  /* ---------- formatting ---------- */
  const nf = new Intl.NumberFormat();
  const hrs = (ms) => ms / 3.6e6;
  const fmtH = (ms) => { const v = hrs(ms); return v >= 100 ? nf.format(Math.round(v)) : v.toFixed(1); };
  const fmtDur = (ms) => { const m = Math.round(ms / 6e4); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
  const hourLabel = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: 'numeric' });
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const monthName = (y, m, o) => new Date(y, m, 1).toLocaleString(undefined, o || { month: 'short' });
  const dayLong = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
  const level = (v, max) => (v <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(v / max) * 4))));

  /* ---------- loading files ---------- */
  function setStatus(msg, err) { const el = $('status'); el.textContent = msg || ''; el.classList.toggle('err', !!err); }
  const tick = () => new Promise((r) => setTimeout(r, 20));

  async function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    try {
      setStatus('Reading your files…');
      await tick();
      const rows = [];
      let used = 0;
      const eat = (text) => {
        let data; try { data = JSON.parse(text); } catch { return; }
        if (Array.isArray(data)) { for (const r of data) rows.push(r); used++; }
      };
      for (const f of files) {
        const lower = f.name.toLowerCase();
        if (lower.endsWith('.zip')) {
          for (const entry of readZip(await f.arrayBuffer())) {
            const base = entry.name.split('/').pop();
            if (/\.json$/i.test(base) && !/video/i.test(base) && /stream/i.test(base)) eat(await entry.text());
          }
        } else if (lower.endsWith('.json') && !/video/i.test(lower)) {
          eat(await f.text());
        }
      }
      setStatus('Crunching ' + nf.format(rows.length) + ' plays…');
      await tick();
      const entries = S.dedupe(S.normalize(rows));
      if (!entries.length) {
        setStatus('I couldn’t find any streaming history in that. Use the zip from Spotify’s “Extended streaming history” request (the file names start with Streaming_History_Audio).', true);
        return;
      }
      start(entries);
    } catch (err) {
      console.error(err);
      setStatus('Something went wrong reading that file: ' + (err && err.message ? err.message : err), true);
    }
  }

  function start(entries) {
    state.all = entries; state.year = null; state.tab = 'artists'; state.limit = 15;
    setStatus('');
    $('landing').hidden = true; $('dash').hidden = false; $('reset').hidden = false;
    window.scrollTo(0, 0);
    render();
  }

  /* ---------- rendering ---------- */
  function render() {
    const d = S.compute(state.all, { year: state.year, minMs: state.strict ? 30000 : 0 });
    lastD = d;
    renderYears(d); renderStats(d); renderMonths(d); renderTop(d); renderHours(d);
    renderPlatforms(d); renderHeat(d); renderCal(d); renderYearly();
  }

  function renderYears(d) {
    const box = clear($('years'));
    const mk = (label, y) => h('button', { class: 'chip' + (state.year === y ? ' on' : ''), role: 'tab', 'aria-selected': String(state.year === y), text: label,
      onclick: () => { state.year = y; state.limit = 15; render(); } });
    box.append(mk('All time', null));
    [...d.years].reverse().forEach((y) => box.append(mk(String(y), y)));
  }

  function renderStats(d) {
    const box = clear($('stats'));
    const tile = (k, v, unit, sub, cls) => h('div', { class: 'stat ' + (cls || '') },
      h('div', { class: 'k', text: k }), h('div', { class: 'v' }, v, unit ? h('small', { text: unit }) : null), h('div', { class: 's', text: sub }));
    if (!d.plays) { box.append(h('div', { class: 'empty', text: 'No plays in this selection.' })); return; }
    box.append(
      tile('Time listened', fmtH(d.totalMs), 'hours', (d.totalMs / 864e5).toFixed(1) + ' days · ' + nf.format(Math.round(d.totalMs / 6e4)) + ' minutes', 'hero-stat'),
      tile('Plays', nf.format(d.plays), '', d.podcastPlays ? nf.format(d.musicPlays) + ' songs · ' + nf.format(d.podcastPlays) + ' episodes' : 'avg ' + (d.totalMs / d.plays / 6e4).toFixed(1) + ' min each'),
      tile('Artists', nf.format(d.uniqueArtists), '', nf.format(d.uniqueTracks) + ' different tracks'),
      tile('Daily average', Math.round(d.totalMs / 6e4 / d.activeDays), 'min', 'across ' + nf.format(d.activeDays) + ' active days'),
      tile('Longest streak', d.longestStreak, d.longestStreak === 1 ? 'day' : 'days', 'listening daily, ended ' + dayLong(d.longestStreakEnd)),
      tile('Skip rate', Math.round(d.skipRate * 100), '%', Math.round(d.shuffleRate * 100) + '% of plays on shuffle'),
    );
  }

  function barChart(box, items, { labelEvery = 1, peakIdx = -1 } = {}) {
    clear(box);
    const max = Math.max(...items.map((i) => i.v), 1);
    items.forEach((it, i) => {
      const col = h('div', { class: 'bar-col' + (i === peakIdx ? ' peak' : ''), tip: it.tip },
        h('div', { class: 'b', style: { height: Math.max(1, (it.v / max) * 100) + '%' } }),
        h('i', { text: it.label && i % labelEvery === 0 ? it.label : '' }));
      box.append(col);
    });
  }

  function renderMonths(d) {
    const all = d.year == null;
    $('months-sub').textContent = all ? 'Hours per month' : 'Hours per month in ' + d.year;
    const items = d.series.map((p) => ({
      v: p.ms, tip: monthName(p.y, p.m, { month: 'long', year: 'numeric' }) + '\n' + fmtH(p.ms) + ' hours',
      label: all ? (p.m === 0 ? String(p.y) : '') : monthName(p.y, p.m),
    }));
    barChart($('months'), items, { peakIdx: items.reduce((b, it, i) => (it.v > items[b].v ? i : b), 0) });
  }

  const TABS = [['artists', 'Artists'], ['tracks', 'Tracks'], ['albums', 'Albums'], ['shows', 'Podcasts']];
  function renderTop(d) {
    const tabs = clear($('toptabs'));
    TABS.forEach(([k, label]) => {
      if (k === 'shows' && !d.shows.length) return;
      tabs.append(h('button', { class: 'tab' + (state.tab === k ? ' on' : ''), role: 'tab', text: label, onclick: () => { state.tab = k; state.limit = 15; renderTop(d); } }));
    });
    if (state.tab === 'shows' && !d.shows.length) state.tab = 'artists';
    $('metric').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === state.metric));

    const m = state.metric;
    const list = [...d[state.tab]].sort((a, b) => b[m] - a[m]);
    const ol = clear($('toplist'));
    if (!list.length) { ol.append(h('li', { class: 'empty', text: 'Nothing here yet.' })); $('more').hidden = true; return; }
    const max = list[0][m];
    list.slice(0, state.limit).forEach((it, i) => {
      ol.append(h('li', null,
        h('div', { class: 'bar', style: { width: (it[m] / max) * 100 + '%' } }),
        h('span', { class: 'rk', text: String(i + 1) }),
        h('div', { class: 'nm' }, h('b', { text: it.name, tip: it.sub ? it.name + '\n' + it.sub : it.name }), it.sub ? h('span', { text: it.sub }) : null),
        h('div', { class: 'vl' }, m === 'ms' ? fmtDur(it.ms) : nf.format(it.plays) + ' plays',
          h('span', { text: m === 'ms' ? nf.format(it.plays) + ' plays' : fmtDur(it.ms) })),
      ));
    });
    const more = $('more');
    more.hidden = list.length <= state.limit && state.limit <= 15;
    more.textContent = list.length > state.limit ? 'Show more' : 'Show less';
    more.onclick = () => { state.limit = list.length > state.limit ? Math.min(state.limit + 25, 100) : 15; renderTop(d); };
  }

  function renderHours(d) {
    $('hours-sub').textContent = d.plays ? 'Peak: ' + hourLabel(d.peakHour) : '';
    barChart($('hours'), d.hours.map((v, i) => ({
      v, tip: hourLabel(i) + '\n' + fmtH(v) + ' hours', label: i % 6 === 0 ? hourLabel(i) : '',
    })), { peakIdx: d.plays ? d.peakHour : -1 });
  }

  function renderPlatforms(d) {
    const box = clear($('platforms'));
    const total = d.platforms.reduce((a, [, v]) => a + v, 0) || 1;
    if (!d.platforms.length) { box.append(h('div', { class: 'empty', text: 'No data.' })); return; }
    d.platforms.slice(0, 6).forEach(([name, ms]) => box.append(h('div', { class: 'meter', tip: fmtH(ms) + ' hours' },
      h('div', { class: 'row' }, h('span', { text: name }), h('span', { text: Math.round((ms / total) * 100) + '%' })),
      h('div', { class: 'rail' }, h('div', { class: 'fill', style: { width: (ms / total) * 100 + '%' } })))));
    if (d.countries.length) {
      let names; try { names = new Intl.DisplayNames(undefined, { type: 'region' }); } catch { names = null; }
      const ctotal = d.countries.reduce((a, [, v]) => a + v, 0) || 1;
      box.append(h('div', { class: 'sub', text: 'Countries: ' + d.countries.slice(0, 4).map(([c, v]) => {
        let n = c; try { n = (names && names.of(c)) || c; } catch { /* keep code */ }
        return n + ' ' + Math.round((v / ctotal) * 100) + '%';
      }).join(' · ') }));
    }
  }

  function renderHeat(d) {
    const box = clear($('heat'));
    const max = Math.max(...d.heat.flat(), 1);
    const g = h('div', { class: 'heat' });
    g.append(h('div'));
    for (let i = 0; i < 24; i++) g.append(h('div', { class: 'hl', text: i % 3 === 0 ? hourLabel(i).replace(/\s?(AM|PM)/i, (m, a) => a.toLowerCase()[0]) : '' }));
    d.heat.forEach((row, wd) => {
      g.append(h('div', { class: 'lbl', text: WEEKDAYS[wd].slice(0, 3) }));
      row.forEach((v, hr) => g.append(h('div', { class: 'cell', 'data-l': String(level(v, max)), tip: WEEKDAYS[wd] + ' ' + hourLabel(hr) + '\n' + fmtDur(v) })));
    });
    box.append(g);
    if (d.plays) box.append(h('p', { class: 'sub', text: 'You listen most on ' + WEEKDAYS[d.peakWeekday] + 's, around ' + hourLabel(d.peakHour) + '.' }));
  }

  function renderCal(d) {
    const box = clear($('cal'));
    const y = d.calYear;
    $('cal-title').textContent = 'Daily activity in ' + y + (d.year == null ? ' (latest year)' : '');
    const max = Math.max(...[...d.days].filter(([k]) => k.startsWith(y + '-')).map(([, v]) => v), 1);
    const wrap = h('div', { class: 'cal' });
    const months = h('div', { class: 'months' });
    const days = h('div', { class: 'days' });
    const first = new Date(y, 0, 1);
    for (let i = 0; i < (first.getDay() + 6) % 7; i++) days.append(h('div', { class: 'cell pad' }));
    const cell = 15; // --cell + --gap
    let col = 0, idx = (first.getDay() + 6) % 7;
    for (let dt = new Date(first); dt.getFullYear() === y; dt.setDate(dt.getDate() + 1)) {
      const key = y + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      const v = d.days.get(key) || 0;
      if (dt.getDate() === 1) months.append(h('span', { text: monthName(y, dt.getMonth()), style: { left: Math.floor(idx / 7) * cell + 'px' } }));
      days.append(h('div', { class: 'cell', 'data-l': String(level(v, max)), tip: dayLong(key) + '\n' + (v ? fmtDur(v) : 'No listening') }));
      idx++; col++;
    }
    wrap.append(months, days);
    box.append(wrap, h('div', { class: 'legend' }, 'Less', ...[0, 1, 2, 3, 4].map((l) => h('div', { class: 'cell', 'data-l': String(l) })), 'More'));
  }

  function renderYearly() {
    const card = $('years-card');
    card.hidden = state.year != null || state.all.length === 0;
    if (card.hidden) return;
    const rows = S.yearly(state.all, state.strict ? 30000 : 0);
    const box = clear($('yearly'));
    box.append(h('div', { class: 'yrow head' }, h('div', { text: 'Year' }), h('div', { text: 'Listening' }), h('div', { text: 'Top artist' }), h('div', { text: 'Most played track' })));
    rows.forEach((r) => box.append(h('div', { class: 'yrow' },
      h('div', { class: 'y', text: String(r.y) }),
      h('div', null, h('b', { text: fmtH(r.ms) + ' hours' }), h('span', { text: nf.format(r.plays) + ' plays' })),
      h('div', null, h('b', { text: r.topArtist ? r.topArtist.name : '–' }), h('span', { text: r.topArtist ? fmtDur(r.topArtist.ms) : '' })),
      h('div', null, h('b', { text: r.topTrack ? r.topTrack.name : '–' }), h('span', { text: r.topTrack ? r.topTrack.sub + ' · ' + r.topTrack.plays + ' plays' : '' })),
    )));
  }

  /* ---------- share card ---------- */
  const dlg = $('cardDlg');
  $('share').addEventListener('click', () => {
    if (!lastD || !lastD.plays) return;
    drawCard($('cardCanvas'), lastD, state.year == null ? 'All time' : String(state.year));
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
  $('cardClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('cardSave').addEventListener('click', () => {
    $('cardCanvas').toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: 'soundprint-' + (state.year == null ? 'all-time' : state.year) + '.png' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  });

  /* ---------- tooltip ---------- */
  const tip = $('tip');
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip; tip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 14)) + 'px';
    tip.style.top = (e.clientY + 18 + hgt > innerHeight ? e.clientY - hgt - 12 : e.clientY + 18) + 'px';
  });
  document.addEventListener('mouseleave', () => { tip.hidden = true; });

  /* ---------- wiring ---------- */
  const drop = $('drop'), input = $('file');
  input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  $('sample').addEventListener('click', () => start(S.dedupe(S.normalize(S.sampleData()))));
  $('strict').addEventListener('change', (e) => { state.strict = e.target.checked; render(); });
  $('metric').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.metric = b.dataset.m; render(); } });
  $('reset').addEventListener('click', () => {
    state.all = []; $('dash').hidden = true; $('landing').hidden = false; $('reset').hidden = true; setStatus('');
  });
  if (location.hash === '#sample') $('sample').click();
  if (!('DecompressionStream' in window)) setStatus('Your browser is too old to open zips directly. Unzip the file first and drop the JSON files instead.', true);
})();
