# Soundprint

Explore your Spotify **Extended streaming history**: top artists/tracks/albums/podcasts, listening by month, hour and weekday, a daily activity calendar, streaks, skip rate and year-by-year trends.

**Everything runs in your browser.** There is no backend, no analytics and no dependencies. The page ships with a strict Content-Security-Policy (`connect-src 'none'`) so it can't send your data anywhere even if it wanted to.

## Use it

1. On spotify.com go to *Account → Privacy settings → Download your data* and request **Extended streaming history** (it can take up to 30 days to arrive).
2. Open the site, drop the zip in (no need to unzip). You can also select the `Streaming_History_Audio_*.json` files.
3. Click *Try it with sample data* (or open `#sample`) to see it without a file.

**Share card:** the *Share card* button renders a 1080×1350 image (hours, top 5 artists and tracks, streak, monthly bars) for the selected year or all time, and downloads it as a PNG. It's drawn locally on a canvas; nothing is uploaded.

Also understands the older "Account data" `StreamingHistory*.json` format (fewer fields, so fewer charts are meaningful).

## Run locally

It's static files. Either double-click `index.html`, or:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy on GitHub Pages

Push this folder to a repo, then *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
The `.gitignore` keeps Spotify export files out of the repo. Please never commit your own data: it contains IP addresses.

## Notes

- Times are shown in the viewer's local time zone.
- "Ignore plays under 30s" (on by default) mirrors Spotify's own definition of a stream. The skip rate always uses every play.
- Video and audiobook rows are ignored. Duplicate rows (e.g. the same file added twice) are removed.
- Files: `stats.js` (parsing + aggregation, testable in Node), `zip.js` (tiny zip reader using `DecompressionStream`), `card.js` (share card), `app.js` (UI), `style.css`.
- Zip support needs a modern browser (Chrome/Edge 80+, Firefox 113+, Safari 16.4+).

Not affiliated with or endorsed by Spotify AB. No Spotify logos, fonts or artwork are used.

## License

MIT
