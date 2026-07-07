# Interactive Stem Player

Host your own music as separate instrument stems, share **one link**, and every
listener gets their **own private mix** — per-stem volume, mute, and solo run
entirely in their browser tab, so one person's adjustments never affect anyone
else's.

- 🎚️ Per-stem volume + mute/solo, master volume, seek, synced waveforms
- 🔒 Per-listener independence — mix state lives only in the visitor's browser
- 🌊 Streams from Cloudflare R2 (HLS MP3 segments) over HTTP/2 — handles 10+ stems × ~10 min without loading whole files into memory
- 📲 Installable PWA — add to home screen, then **download songs for fully offline playback**
- 📱 Works in Safari/Chrome/Firefox on phone, tablet, desktop — no app, no account
- 🪶 Static front-end, no build step, no server

---

## How it works

The front-end is two static pages, plain ES modules, no bundler:

- **`index.html`** — landing page. Lists every song from `catalog.json` and links into the player.
- **`stream.html?song=<id>`** — player page. Reads a song's `manifest.json` and builds a [`@stemplayer-js/stemplayer-js`](https://github.com/firstcoders/stemplayer-js) component.

Audio is **not** loaded whole. A local CLI pre-processes each song into HLS MP3
segments + waveform JSON and uploads everything to a public-read **Cloudflare R2**
bucket, served through a **custom domain over HTTP/2** (the `pub-*.r2.dev` dev URL
is HTTP/1.1-only and caps the browser at ~6 connections — see
`docs/R2-SETUP.md`). The player streams segments on demand through one shared Web
Audio clock, which keeps the stems sample-accurate. A service worker (`sw.js`)
makes the app installable and, on request, downloads a whole song into Cache
Storage for offline playback.

```
your stems ──(scripts/segment-song.js)──▶ HLS segments + waveform.json + manifest.json
                                                          │
                                                   upload to R2
                                                          │
   index.html / stream.html  ◀── fetch catalog.json / manifest.json ──  R2 (custom domain, HTTP/2)
```

Storage layout on R2:

```
catalog.json                     # index of all songs (built by the CLI)
songs/<id>/manifest.json         # one song: title, artist, duration, stems — mutable pointer (no-cache)
songs/<id>/<stem-slug>/<rev>/audio.m3u8 + seg_***.mp3
songs/<id>/<stem-slug>/<rev>/waveform.json
```

`<rev>` is a short content hash of the source stem. Media is served `immutable`,
so versioning the path by content is what lets a **replaced** stem reach listeners
who already cached the old bytes: new content → new `<rev>` → new URL → fresh
fetch. The manifest is the single mutable pointer (`no-cache`, revalidated). Old
revisions left behind by a replace are swept with `npm run prune-media` (dry-run
by default; `-- --apply` to delete). New/removed stems already propagate via the
`no-cache` manifest + catalog.

---

## Add a song

Stems live on your machine; the CLI does the encoding and upload. You need
`ffmpeg`, `ffprobe`, `audiowaveform`, and `rclone` installed (the script checks
and tells you what's missing), plus R2 configured once — see
[`docs/R2-SETUP.md`](docs/R2-SETUP.md).

1. **Export one audio file per stem** into a folder. The **folder name is ignored**
   here (the title is set on the command line). Supported inputs: `.wav`, `.mp3`,
   `.flac`, `.aiff`, `.aif`, `.m4a`.

   - **Stem order** in the player follows a numeric filename prefix:
     `01-drums.wav`, `02-bass.wav`, `03-vocals.wav`. The prefix is stripped from the
     displayed name (`drums`, `bass`, `vocals`). Files without a prefix sort after,
     by filename.
   - Stems **no longer need to be the same length** — they share a zero start, and
     shorter stems simply end early. (Equal length is reported as a note, not a gate.)

2. **Run the CLI:**

   ```bash
   node scripts/segment-song.js path/to/stem-folder \
     --id="my-song" --title="My Song" --artist="Andrew Bray"
   ```

   This segments + generates waveforms locally (into `dist/`), uploads to
   `r2:stem-player/songs/my-song/`, and refreshes `catalog.json`. Flags:
   `--bitrate=128k`, `--bucket=stem-player`, `--no-upload` (encode only).

### Upload a whole album

Each subfolder is one song; the folder name becomes the title:

```bash
ARTIST="My Band"
ALBUM="$HOME/Music/My Album"
for dir in "$ALBUM"/*/; do
  folder=$(basename "$dir")
  id=$(printf '%s' "$folder" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
  node scripts/segment-song.js "$dir" --id="$id" --title="$folder" --artist="$ARTIST" \
    || echo "!!! FAILED: $folder"
done
```

### Rebuild the catalog only

If songs are already on R2 and you just need to regenerate `catalog.json`
(e.g. after a manual change), skip re-encoding:

```bash
node scripts/refresh-catalog.js          # [--bucket=stem-player]
```

---

## Admin tool (local web UI)

For day-to-day curation there's a small localhost web app that wraps the same
pipeline — add songs, edit title/artist, drag-reorder stems, and add / rename /
delete individual stems, all writing straight to R2.

```bash
npm run admin            # → http://127.0.0.1:4321  [--port=4321] [--bucket=stem-player]
```

- **Add a song:** drop a folder's audio files onto the page, fill in title/artist,
  and it segments + uploads + refreshes the catalog (same as `segment-song.js`).
- **Edit:** change title/artist, drag the ☰ handle to reorder stems (no
  re-encoding), rename a stem's label inline, delete a stem, or drop one file to
  add a stem.
- **Delete:** removes the song (or stem) from R2 and refreshes the catalog.

**Security model:** the server binds to `127.0.0.1` only and is the *one* component
that touches R2 credentials — exactly like the CLI. There is no login because the
gate is already possession of the local `rclone` creds. Nothing here ships to the
public site; the deployed pages stay read-only and secret-free.

---

## Run it locally

The front-end fetches from R2 over HTTP, which browsers block from `file://`.
Serve the folder:

```bash
npm run serve            # python3 -m http.server 8000 → http://localhost:8000
```

`http://localhost:8000` is already in the R2 CORS allow-list (see the runbook).
The pages read live from R2 (`R2_BASE` in `js/config.js`), so the local site
always reflects whatever is in the bucket — no sync step. Run it alongside
`npm run admin` and reload after an edit to see your changes.

---

## Deploy (GitHub Pages)

This repo is an **org site**: it lives in the `rehearsal-tracks` org and is named
`rehearsal-tracks.github.io`, so Pages serves it at the root of that subdomain.

Deploy with **`npm run deploy`**, not a bare `git push`:

```bash
npm run deploy           # stamp sw.js with a content hash → commit → push
```

The stamp writes a hash of the app-shell files into the service worker's
`SHELL_VERSION`, so every content change makes `sw.js` byte-different — that's how
the browser notices a new version, re-precaches the shell, and rolls its caches.
A bare push updates the files but the cached service worker / esm.sh copy can go
stale. Clients auto-activate the new worker on the next cold launch (or via the
in-app "↻ Reload" pill). One-time Pages setup:

1. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
2. Link: **`https://rehearsal-tracks.github.io`**

Because the repo is `<org>.github.io`, the site is served at the domain root — all
in-page paths are relative, so nothing in the code hardcodes the URL. The empty
`.nojekyll` file tells Pages to serve every file as-is. The deployed site is
**read-only** and holds no secrets — R2 credentials stay local, used only by
`rclone` during uploads. New origins must be added to the R2 CORS list (see
`docs/R2-SETUP.md`).

---

## Tests

Pure logic (slug/ordering, length report, manifest, catalog view helpers, manifest
transforms, path guards) is unit tested with Node's built-in runner; rclone/R2/HTTP
I/O is verified manually.

```bash
npm test
```

---

## Per-listener independence

There is no server and no shared state. The site serves static audio; all mixing
happens in `GainNode`s inside each visitor's own `AudioContext`. Two people opening
the same link hear whatever *they* set — the link is shared, the mix is not.

---

## Project layout

| Path | What |
|---|---|
| `index.html`, `js/landing.js` | Landing page (song list from `catalog.json` + offline-downloads section) |
| `stream.html`, `js/stream.js` | Player page (one song via `stemplayer-js`) |
| `js/nav.js`, `js/data.js`, `js/config.js`, `js/lib/` | Shared nav drawer, R2 fetches, R2 base URL, pure view helpers |
| `js/prefetch.js` | Anticipatory segment prefetch (warms the HTTP cache ahead of the playhead) |
| `sw.js`, `js/sw-register.js`, `manifest.webmanifest`, `icons/` | PWA: installable app shell + auto-update flow |
| `js/offline.js`, `js/offline-ui.js` | Offline downloads — per-song Cache Storage + storage UI |
| `css/styles.css` | Dark design system (shared by both pages) |
| `scripts/segment-song.js` | CLI: encode + upload one song; refresh catalog |
| `scripts/refresh-catalog.js` | Rebuild `catalog.json` from R2 |
| `scripts/prune-media.js` | Delete orphaned old-rev media from R2 (dry-run; `-- --apply`) |
| `scripts/deploy.js`, `scripts/stamp-sw.js` | Deploy: stamp `sw.js` version → commit → push |
| `scripts/admin-server.js`, `scripts/admin/public/` | Local admin web UI (`npm run admin`) |
| `scripts/lib/` | Pipeline modules (media, manifest, catalog, ordering, segment, upload, manifest-ops, rev, prune, safe-path) |
| `docs/R2-SETUP.md` | One-time Cloudflare R2 setup runbook |
| `legacy/` | The original v0 whole-file player, retired |
