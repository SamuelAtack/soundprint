/* Draws the shareable "wrapped"-style card onto a <canvas>. No DOM besides the canvas passed in. */
(function (root) {
  const W = 1080, H = 1350;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const GREEN = '#30d67f', MUTED = '#b3b3b3', FAINT = '#727272';
  const nf = new Intl.NumberFormat();

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text.trimEnd() + '…';
  }
  const font = (w, px) => w + ' ' + px + 'px ' + FONT;

  function logo(ctx, x, y, s, color) {
    ctx.strokeStyle = color; ctx.lineWidth = s * 0.1; ctx.lineCap = 'round';
    [[6, 20, 12], [11, 24, 8], [16, 18, 14], [21, 26, 6], [26, 20, 12]].forEach(([bx, y1, y2]) => {
      ctx.beginPath(); ctx.moveTo(x + (bx / 32) * s, y + (y1 / 32) * s); ctx.lineTo(x + (bx / 32) * s, y + (y2 / 32) * s); ctx.stroke();
    });
  }

  function column(ctx, title, items, x, y, w) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = FAINT; ctx.font = font(700, 22);
    ctx.fillText(title.toUpperCase().split('').join(' '), x, y);
    items.slice(0, 5).forEach((it, i) => {
      const yy = y + 62 + i * 84;
      ctx.fillStyle = i === 0 ? GREEN : FAINT; ctx.font = font(800, 34);
      ctx.fillText(String(i + 1), x, yy);
      ctx.fillStyle = '#fff'; ctx.font = font(700, 32);
      ctx.fillText(fit(ctx, it.name, w - 56), x + 50, yy);
      if (it.sub) { ctx.fillStyle = MUTED; ctx.font = font(400, 24); ctx.fillText(fit(ctx, it.sub, w - 56), x + 50, yy + 32); }
    });
  }

  /**
   * @param canvas HTMLCanvasElement
   * @param d      result of Stats.compute()
   * @param label  e.g. "2026" or "All time"
   */
  function drawCard(canvas, d, label) {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // background
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(150, 100, 20, 150, 100, 820);
    g.addColorStop(0, 'rgba(48,214,127,0.42)'); g.addColorStop(1, 'rgba(48,214,127,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(1050, 1300, 10, 1050, 1300, 600);
    g.addColorStop(0, 'rgba(48,214,127,0.18)'); g.addColorStop(1, 'rgba(48,214,127,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // header
    logo(ctx, 70, 62, 44, GREEN);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = '#fff'; ctx.font = font(800, 30); ctx.fillText('Soundprint', 124, 96);
    ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.font = font(700, 30);
    ctx.fillText(label.toUpperCase().split('').join(' '), W - 70, 96);

    // hero number
    const hours = d.totalMs / 3.6e6;
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED; ctx.font = font(600, 34); ctx.fillText('I listened for', 70, 230);
    ctx.fillStyle = GREEN; ctx.font = font(800, 210);
    const big = hours >= 100 ? nf.format(Math.round(hours)) : hours.toFixed(1);
    ctx.fillText(big, 62, 420);
    const bw = ctx.measureText(big).width;
    ctx.fillStyle = '#fff'; ctx.font = font(800, 62); ctx.fillText('hours', 62 + bw + 22, 420);
    ctx.fillStyle = MUTED; ctx.font = font(500, 30);
    ctx.fillText((d.totalMs / 864e5).toFixed(1) + ' days · ' + nf.format(Math.round(d.totalMs / 6e4)) + ' minutes · ' + nf.format(d.plays) + ' plays', 70, 478);

    // top lists
    column(ctx, 'Top artists', d.artists.slice(0, 5).map((a) => ({ name: a.name, sub: nf.format(Math.round(a.ms / 3.6e6)) + ' hours' })), 70, 600, 430);
    column(ctx, 'Top tracks', d.tracks, 580, 600, 430);

    // stat chips
    const hl = new Date(2000, 0, 1, d.peakHour).toLocaleTimeString([], { hour: 'numeric' });
    const chips = [
      ['Most active', hl],
      ['Longest streak', d.longestStreak + (d.longestStreak === 1 ? ' day' : ' days')],
      ['Artists', nf.format(d.uniqueArtists)],
    ];
    const cw = (W - 140 - 40) / 3;
    chips.forEach(([k, v], i) => {
      const x = 70 + i * (cw + 20), y = 1062;
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; rrect(ctx, x, y, cw, 120, 18); ctx.fill();
      ctx.fillStyle = MUTED; ctx.font = font(600, 22); ctx.textAlign = 'left'; ctx.fillText(k, x + 24, y + 40);
      ctx.fillStyle = '#fff'; ctx.font = font(800, 44); ctx.fillText(fit(ctx, v, cw - 44), x + 24, y + 92);
    });

    // month bars
    const s = d.series; const max = Math.max(...s.map((p) => p.ms), 1);
    const bx = 70, bwAll = W - 140, by = 1278, bh = 64, gap = 4;
    const n = s.length || 1, barW = Math.max(3, (bwAll - gap * (n - 1)) / n);
    s.forEach((p, i) => {
      const h = Math.max(4, (p.ms / max) * bh);
      ctx.fillStyle = p.ms === max ? GREEN : 'rgba(48,214,127,0.45)';
      rrect(ctx, bx + i * (barW + gap), by - h, barW, h, Math.min(4, barW / 2)); ctx.fill();
    });

    ctx.textAlign = 'center'; ctx.fillStyle = FAINT; ctx.font = font(500, 22);
    ctx.fillText('Made with Soundprint', W / 2, 1322);
    ctx.textAlign = 'left';
  }

  root.drawCard = drawCard;
})(typeof window !== 'undefined' ? window : globalThis);
