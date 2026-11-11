/* Parsing + aggregation. Pure functions, no DOM, so it can be tested in Node. */
(function (root) {
  const PLATFORMS = [
    [/web_player|chrome|firefox|safari|edge|opera|browser/, 'Web player'],
    [/android/, 'Android'],
    [/\bios\b|iphone|ipad|ipod/, 'iOS'],
    [/windows/, 'Windows'],
    [/os x|osx|macos|\bmac/, 'macOS'],
    [/cast/, 'Cast'],
    [/linux|ubuntu|fedora|debian|arch/, 'Linux'],
    [/tv|sonos|playstation|ps[345]|xbox|speaker|alexa|echo|partner|car/, 'TV, car & speakers'],
  ];
  function platformOf(p) {
    const s = String(p || '').toLowerCase();
    for (const [re, name] of PLATFORMS) if (re.test(s)) return name;
    return 'Other';
  }
  const pad = (n) => (n < 10 ? '0' : '') + n;

  /** Turn raw Spotify rows (extended OR basic account-data format) into compact entries. */
  function normalize(rows) {
    const out = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      let t, ms, kind, artist, track, album = '', uri, platform = '', country = '', skipped = false, shuffle = false;
      if (r.ts && typeof r.ms_played === 'number') {
        t = Date.parse(r.ts); ms = r.ms_played;
        if (r.master_metadata_track_name) {
          kind = 'music';
          artist = r.master_metadata_album_artist_name || 'Unknown artist';
          track = r.master_metadata_track_name;
          album = r.master_metadata_album_album_name || '';
          uri = r.spotify_track_uri || artist + '|' + track;
        } else if (r.episode_name) {
          kind = 'podcast';
          artist = r.episode_show_name || 'Unknown show';
          track = r.episode_name;
          uri = r.spotify_episode_uri || artist + '|' + track;
        } else continue; // audiobooks / unknown
        platform = platformOf(r.platform);
        country = r.conn_country || '';
        skipped = !!r.skipped || r.reason_end === 'fwdbtn';
        shuffle = !!r.shuffle;
      } else if (r.endTime && typeof r.msPlayed === 'number' && r.trackName) {
        t = Date.parse(String(r.endTime).replace(' ', 'T') + 'Z'); ms = r.msPlayed;
        kind = 'music'; artist = r.artistName || 'Unknown artist'; track = r.trackName;
        uri = artist + '|' + track; platform = 'Other';
      } else continue;
      if (!Number.isFinite(t)) continue;
      const d = new Date(t); // local time of whoever opens the page
      const y = d.getFullYear(), mo = d.getMonth(), dd = d.getDate();
      out.push({
        t, ms, kind, artist, track, album, uri, platform, country, skipped, shuffle,
        y, mo, h: d.getHours(), wd: (d.getDay() + 6) % 7, // Monday = 0
        day: y + '-' + pad(mo + 1) + '-' + pad(dd),
      });
    }
    return out;
  }

  function dedupe(entries) {
    const seen = new Set(), out = [];
    for (const e of entries) {
      const k = e.t + '|' + e.uri + '|' + e.ms;
      if (seen.has(k)) continue;
      seen.add(k); out.push(e);
    }
    return out;
  }

  const bump = (m, key, ms, init) => {
    let o = m.get(key);
    if (!o) { o = init(); m.set(key, o); }
    o.ms += ms; o.plays++;
  };
  const sortedBy = (m, f) => [...m.values()].sort((a, b) => b[f] - a[f]);
  const dayIndex = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };

  function compute(all, opt) {
    const minMs = (opt && opt.minMs) || 0;
    const year = opt && opt.year != null ? opt.year : null;
    const inYear = year == null ? all : all.filter((e) => e.y === year);
    const rows = minMs ? inYear.filter((e) => e.ms >= minMs) : inYear;

    const artists = new Map(), tracks = new Map(), albums = new Map(), shows = new Map();
    const days = new Map(), months = new Map(), platforms = new Map(), countries = new Map();
    const hours = new Array(24).fill(0), weekdays = new Array(7).fill(0);
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let totalMs = 0, shuffled = 0, musicPlays = 0, podcastPlays = 0;

    for (const e of rows) {
      totalMs += e.ms;
      if (e.shuffle) shuffled++;
      if (e.kind === 'music') {
        musicPlays++;
        bump(artists, e.artist, e.ms, () => ({ name: e.artist, sub: '', ms: 0, plays: 0 }));
        bump(tracks, e.uri, e.ms, () => ({ name: e.track, sub: e.artist, ms: 0, plays: 0 }));
        if (e.album) bump(albums, e.artist + '\u0000' + e.album, e.ms, () => ({ name: e.album, sub: e.artist, ms: 0, plays: 0 }));
      } else {
        podcastPlays++;
        bump(shows, e.artist, e.ms, () => ({ name: e.artist, sub: '', ms: 0, plays: 0 }));
      }
      days.set(e.day, (days.get(e.day) || 0) + e.ms);
      const mk = e.y * 12 + e.mo;
      months.set(mk, (months.get(mk) || 0) + e.ms);
      hours[e.h] += e.ms; weekdays[e.wd] += e.ms; heat[e.wd][e.h] += e.ms;
      platforms.set(e.platform, (platforms.get(e.platform) || 0) + e.ms);
      if (e.country) countries.set(e.country, (countries.get(e.country) || 0) + e.ms);
    }

    // month series
    const series = [];
    if (year != null) {
      for (let m = 0; m < 12; m++) series.push({ y: year, m, ms: months.get(year * 12 + m) || 0 });
    } else if (months.size) {
      const keys = [...months.keys()];
      for (let k = Math.min(...keys); k <= Math.max(...keys); k++) series.push({ y: Math.floor(k / 12), m: k % 12, ms: months.get(k) || 0 });
    }

    // streaks / busiest day
    const dayKeys = [...days.keys()].sort();
    let longest = 0, run = 0, runEnd = null, longestEnd = null, prev = null;
    for (const k of dayKeys) {
      const i = dayIndex(k);
      run = prev !== null && i === prev + 1 ? run + 1 : 1;
      if (run > longest) { longest = run; longestEnd = k; }
      prev = i;
    }
    let busiest = null;
    for (const [k, ms] of days) if (!busiest || ms > busiest.ms) busiest = { day: k, ms };

    const peak = (arr) => arr.reduce((bi, v, i) => (v > arr[bi] ? i : bi), 0);
    const years = [...new Set(all.map((e) => e.y))].sort((a, b) => a - b);

    return {
      year, years, plays: rows.length, musicPlays, podcastPlays, totalMs,
      skipRate: inYear.length ? inYear.filter((e) => e.skipped).length / inYear.length : 0,
      shuffleRate: rows.length ? shuffled / rows.length : 0,
      artists: sortedBy(artists, 'ms'), tracks: sortedBy(tracks, 'ms'),
      albums: sortedBy(albums, 'ms'), shows: sortedBy(shows, 'ms'),
      uniqueArtists: artists.size, uniqueTracks: tracks.size,
      days, activeDays: days.size, longestStreak: longest, longestStreakEnd: longestEnd, busiest,
      series, hours, weekdays, heat, peakHour: peak(hours), peakWeekday: peak(weekdays),
      platforms: [...platforms].sort((a, b) => b[1] - a[1]),
      countries: [...countries].sort((a, b) => b[1] - a[1]),
      calYear: year != null ? year : rows.length ? Math.max(...rows.map((e) => e.y)) : new Date().getFullYear(),
    };
  }

  /** One row per year: totals + top artist + top track. */
  function yearly(all, minMs) {
    const by = new Map();
    for (const e of all) {
      if (e.ms < (minMs || 0)) continue;
      let y = by.get(e.y);
      if (!y) { y = { y: e.y, ms: 0, plays: 0, artists: new Map(), tracks: new Map() }; by.set(e.y, y); }
      y.ms += e.ms; y.plays++;
      if (e.kind === 'music') {
        bump(y.artists, e.artist, e.ms, () => ({ name: e.artist, ms: 0, plays: 0 }));
        bump(y.tracks, e.uri, e.ms, () => ({ name: e.track, sub: e.artist, ms: 0, plays: 0 }));
      }
    }
    return [...by.values()].sort((a, b) => b.y - a.y).map((y) => ({
      y: y.y, ms: y.ms, plays: y.plays,
      topArtist: sortedBy(y.artists, 'ms')[0], topTrack: sortedBy(y.tracks, 'plays')[0],
    }));
  }

  /** Deterministic fake history so people can try the dashboard without their own file. */
  function sampleData() {
    let s = 20240607;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const names = ['Neon Harbor', 'The Paper Foxes', 'Luna Vale', 'Static Orchard', 'Midnight Cartographers', 'Okra Sound System',
      'Velvet Parade', 'Juno & The Tides', 'Glass Canyon', 'Marlowe Kane', 'Hollow Meridian', 'Saffron Skies', 'DJ Pelican',
      'Cedar Row', 'Atlas Bloom', 'Violet Engine', 'The Quiet Nine', 'Nova Pines', 'Ruby Static', 'Echo Lantern'];
    const adj = ['Golden', 'Late', 'Paper', 'Electric', 'Slow', 'Hidden', 'Blue', 'Silent', 'Wild', 'Distant'];
    const noun = ['Hours', 'Rivers', 'Signals', 'Summer', 'Windows', 'Parade', 'Gravity', 'Letters', 'Echoes', 'Weather'];
    const artists = names.map((n, i) => ({
      n, w: 1 / (i + 1.5), peak: 2023 + Math.floor(rnd() * 4),
      tracks: Array.from({ length: 10 }, (_, j) => ({
        t: adj[Math.floor(rnd() * 10)] + ' ' + noun[Math.floor(rnd() * 10)], a: n + ' — Vol. ' + (1 + (j % 3)), id: i * 100 + j,
      })),
    }));
    const platforms = ['Android 14', 'windows', 'web_player', 'Android 14', 'cast to device'];
    const rows = [];
    for (let day = 0; day < 1400; day++) {
      const d0 = new Date(Date.UTC(2022, 11, 30) + day * 864e5);
      if (rnd() < 0.12) continue;
      const year = d0.getUTCFullYear(), n = Math.floor(8 + rnd() * 40 * (d0.getUTCDay() % 6 === 0 ? 1.4 : 1));
      let hour = 7 + rnd() * 3, platform = platforms[Math.floor(rnd() * platforms.length)];
      for (let i = 0; i < n; i++) {
        const ws = artists.map((a) => a.w * (1 + 2.5 * Math.exp(-Math.abs(year - a.peak))));
        let r = rnd() * ws.reduce((x, y) => x + y, 0), a = artists[0];
        for (let k = 0; k < ws.length; k++) { r -= ws[k]; if (r <= 0) { a = artists[k]; break; } }
        const tr = a.tracks[Math.floor(Math.pow(rnd(), 1.8) * a.tracks.length)];
        const skipped = rnd() < 0.3, dur = 150000 + rnd() * 120000, ms = skipped ? 2000 + rnd() * 25000 : dur;
        hour += ms / 3.6e6 + (rnd() < 0.08 ? 2 + rnd() * 5 : 0.01);
        if (hour >= 24) break;
        rows.push({
          ts: new Date(d0.getTime() + hour * 3.6e6).toISOString(), platform, ms_played: Math.round(ms), conn_country: 'US',
          master_metadata_track_name: tr.t, master_metadata_album_artist_name: a.n, master_metadata_album_album_name: tr.a,
          spotify_track_uri: 'spotify:track:sample' + tr.id, episode_name: null, episode_show_name: null,
          reason_end: skipped ? 'fwdbtn' : 'trackdone', shuffle: rnd() < 0.5, skipped,
        });
      }
    }
    return rows;
  }

  const api = { normalize, dedupe, compute, yearly, sampleData, platformOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
