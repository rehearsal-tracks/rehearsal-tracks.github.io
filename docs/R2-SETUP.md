# R2 Setup Runbook

One-time operator setup for the Cloudflare R2 bucket that stores stem audio
(HLS segments + waveform JSON + per-song `manifest.json`). After this, the
`segment-song.js` CLI handles all uploads automatically.

## 1. Create the bucket

1. Cloudflare dashboard → **R2** → **Create bucket** → name it exactly `stem-player`.
   (R2 requires a payment method on file to enable, but there are no charges at
   this scale: 10 GB storage free, zero egress fees.)

## 2. Enable public access

2. Bucket → **Settings → Public access** → enable the **`r2.dev` managed URL**.
   Record it — it looks like `https://pub-xxxxxxxx.r2.dev`. This value is the
   `R2_BASE` constant in `js/config.js`.

## 3. CORS policy

3. Bucket → **Settings → CORS policy** → paste:

   ```json
   [{ "AllowedOrigins": ["https://andrew-bray.github.io", "http://localhost:8000"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["Range"],
      "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"] }]
   ```

   - `AllowedOrigins` — the GitHub Pages site and the local dev server.
   - `AllowedHeaders: Range` + `ExposeHeaders` — required for HLS streaming
     (the player fetches partial byte ranges of each segment rather than whole
     files).

## 4. Configure rclone (upload credentials)

4. In R2, **Manage R2 API Tokens** → **Create API token** with **Object Read & Write**,
   scoped to the `stem-player` bucket. On the confirmation screen, record the
   **Access Key ID**, **Secret Access Key** (shown once), and **endpoint**
   (`https://<accountid>.r2.cloudflarestorage.com`).
5. Run `rclone config` → new remote named `r2`, storage type `s3`, provider
   `Cloudflare`, supply the access key / secret / endpoint, leave region `auto`.

   Verify with `rclone ls r2:stem-player` (empty output, no error = success).
   Note: `rclone lsd r2:` returns 403 with a bucket-scoped token — that is
   expected and correct; the token cannot list all account buckets.

## 5. Verify upload + public-read round-trip

After the CLI exists, upload the fixture and confirm public reads work:

```bash
node scripts/segment-song.js <fixture-dir> --id=fixture --title="Fixture" --artist="Test" --bucket=stem-player
curl -sI "https://<pub-url>/songs/fixture/manifest.json" | grep -i "200\|content-type"
curl -sI -H "Range: bytes=0-1" "https://<pub-url>/songs/fixture/lead/seg_000.ts" | grep -i "206\|content-range"
```

Expected: manifest returns `200`; segment returns `206 Partial Content`
(range requests work — required for streaming).
