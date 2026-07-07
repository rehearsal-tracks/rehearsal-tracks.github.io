# R2 Setup Runbook

One-time operator setup for the Cloudflare R2 bucket that stores stem audio
(HLS segments + waveform JSON + per-song `manifest.json`, plus a `catalog.json`
index at the bucket root). After this, the `segment-song.js` CLI handles all
uploads automatically.

## 1. Create the bucket

1. Cloudflare dashboard → **R2** → **Create bucket** → name it exactly `stem-player`.
   (R2 requires a payment method on file to enable, but there are no charges at
   this scale: 10 GB storage free, zero egress fees.)

## 2. Enable public access

2. Bucket → **Settings → Public access** → enable the **`r2.dev` managed URL**
   (`https://pub-xxxxxxxx.r2.dev`). This works, but the managed dev URL is
   **HTTP/1.1-only** (and rate-limited), so the browser caps at ~6 connections
   per host — full offline downloads of a ~105 MB song crawl.

## 3. Connect a custom domain (HTTP/2)

3. **Connect a custom domain for HTTP/2.** Bucket → **Settings → Custom Domains
   → Connect Domain** → enter a subdomain on a Cloudflare-managed zone (e.g.
   `media.<yourdomain>`). Cloudflare provisions DNS + a cert and serves the bucket
   over **HTTP/2 + HTTP/3**, removing the connection cap (helps streaming, the
   prefetcher, and offline downloads). Wait for **Active**, then verify:

   ```bash
   curl -sI -o /dev/null -w 'http_version=%{http_version}\n' https://media.<yourdomain>/catalog.json
   # expect http_version=2 (or 3)
   ```

   **This custom-domain URL is the `R2_BASE` constant in `js/config.js`** (and the
   duplicated `R2_ORIGIN` in `sw.js` — a classic service worker can't import the
   module). The live bucket uses `https://media.andrewbray.us`. Immutable media is
   edge-cached by Cloudflare; `manifest.json`/`catalog.json` are `no-cache` and
   must keep revalidating — if Cloudflare over-caches JSON, add a "Bypass cache"
   Cache Rule on `*/manifest.json` + `/catalog.json`. Full runbook:
   `~/.claude/plans/2026-07-07-r2-custom-domain-http2-runbook.md`.

## 4. CORS policy

4. Bucket → **Settings → CORS policy** → paste:

   ```json
   [{ "AllowedOrigins": ["https://rehearsal-tracks.github.io", "http://localhost:8000"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["Range"],
      "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"] }]
   ```

   - `AllowedOrigins` — the GitHub Pages site (`rehearsal-tracks.github.io`) and
     the local dev server. Add any new origin here or its R2 fetches are blocked.
   - `AllowedHeaders: Range` + `ExposeHeaders` — required for HLS streaming
     (the player fetches partial byte ranges of each segment rather than whole
     files).

## 5. Configure rclone (upload credentials)

5. In R2, **Manage R2 API Tokens** → **Create API token** with **Object Read & Write**,
   scoped to the `stem-player` bucket. On the confirmation screen, record the
   **Access Key ID**, **Secret Access Key** (shown once), and **endpoint**
   (`https://<accountid>.r2.cloudflarestorage.com`).
6. Run `rclone config` → new remote named `r2`, storage type `s3`, provider
   `Cloudflare`, supply the access key / secret / endpoint, leave region `auto`.

   Verify with `rclone ls r2:stem-player` (empty output, no error = success).
   Note: `rclone lsd r2:` returns 403 with a bucket-scoped token — that is
   expected and correct; the token cannot list all account buckets.

   **Bucket-scoped tokens and `--s3-no-check-bucket`.** A bucket-scoped token
   cannot `CreateBucket`. By default rclone tries to check/create the destination
   bucket before writing, which returns `403 AccessDenied` (most visibly on writes
   to the bucket root, like `catalog.json`). The CLI passes `--s3-no-check-bucket`
   on every upload to skip that check, so no config change is required. If you run
   `rclone` by hand against this bucket, add the same flag, e.g.
   `rclone cat r2:stem-player/catalog.json --s3-no-check-bucket`.

## 6. Verify upload + public-read round-trip

After the CLI exists, upload the fixture and confirm public reads work:

```bash
node scripts/segment-song.js <fixture-dir> --id=fixture --title="Fixture" --artist="Test" --bucket=stem-player
curl -sI "https://<pub-url>/songs/fixture/manifest.json" | grep -i "200\|content-type"
curl -sI -H "Range: bytes=0-1" "https://<pub-url>/songs/fixture/lead/seg_000.mp3" | grep -i "206\|content-range"
```

Expected: manifest returns `200`; segment returns `206 Partial Content`
(range requests work — required for streaming).
