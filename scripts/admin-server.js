// scripts/admin-server.js — localhost-only admin server for the stem catalog on R2.
import { createServer } from "node:http";
import { readFile, readdir, rm, stat, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname, extname, normalize } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listSongIds, readRemoteManifest, uploadJson, uploadDir, deleteRemoteSong, deleteRemoteStem, updateRemoteManifest } from "./lib/upload.js";
import { refreshCatalog } from "./lib/catalog.js";
import { safeId, safeFilename } from "./lib/safe-path.js";
import { reorderStems, editMeta, addStem, renameStem, removeStem } from "./lib/manifest-ops.js";

const pexec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "admin", "public");
const TMP_ROOT = join(tmpdir(), "stem-admin-uploads");

const argv = process.argv.slice(2);
const getArg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const PORT = Number(getArg("port", "4321"));
const BUCKET = getArg("bucket", "stem-player");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(payload);
}
function sendError(res, status, message) { send(res, status, { error: message }); }

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function serveStatic(res, urlPath) {
  const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return sendError(res, 403, "forbidden");
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { sendError(res, 404, "not found"); }
}

// Sweep upload temp dirs older than a few hours (orphans from abandoned uploads).
async function sweepTempDirs() {
  try {
    const now = Date.now();
    for (const name of await readdir(TMP_ROOT)) {
      const p = join(TMP_ROOT, name);
      const age = now - (await stat(p)).mtimeMs;
      if (age > 6 * 3600 * 1000) await rm(p, { recursive: true, force: true });
    }
  } catch { /* TMP_ROOT may not exist yet — fine */ }
}

async function refresh() {
  return refreshCatalog({
    listSongIds: () => listSongIds(BUCKET),
    readManifest: (id) => readRemoteManifest(BUCKET, id),
    writeCatalog: (c) => uploadJson(c, BUCKET, "catalog.json"),
  });
}

async function route(req, res, pathname) {
  const parts = pathname.split("/").filter(Boolean); // ["api", ...]

  // GET /api/catalog — fall back to an empty catalog if catalog.json doesn't exist yet.
  if (req.method === "GET" && parts[1] === "catalog" && parts.length === 2) {
    try {
      const { stdout } = await pexec("rclone", ["cat", `r2:${BUCKET}/catalog.json`, "--s3-no-check-bucket"]);
      return send(res, 200, stdout, { "content-type": "application/json" });
    } catch (e) {
      const msg = `${e.stderr || ""}${e.message || ""}`.toLowerCase();
      if (msg.includes("not found") || msg.includes("doesn't exist") || msg.includes("no such")) {
        return send(res, 200, { schemaVersion: 1, songs: [] });
      }
      throw e;
    }
  }

  // GET /api/songs/:id
  if (req.method === "GET" && parts[1] === "songs" && parts.length === 3) {
    const id = safeId(parts[2]);
    const manifest = await readRemoteManifest(BUCKET, id);
    return send(res, 200, manifest);
  }

  // PUT /api/upload/:uploadId/:filename  → stream the raw body to a temp file
  if (req.method === "PUT" && parts[1] === "upload" && parts.length === 4) {
    const uploadId = safeId(parts[2]);
    const filename = safeFilename(decodeURIComponent(parts[3]));
    const dir = join(TMP_ROOT, uploadId);
    await mkdir(dir, { recursive: true });
    const dest = join(dir, filename);
    const { createWriteStream } = await import("node:fs");
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(dest);
      req.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", reject);
      req.on("error", reject);
    });
    return send(res, 201, { ok: true, filename });
  }

  // POST /api/songs  { uploadId, id, title, artist, bitrate? }
  if (req.method === "POST" && parts[1] === "songs" && parts.length === 2) {
    const { uploadId, id, title, artist, bitrate = "128k" } = await readJson(req);
    const safeUp = safeId(uploadId), safeSong = safeId(id);
    if (!title || !artist) return sendError(res, 400, "title and artist are required");
    const inputDir = join(TMP_ROOT, safeUp);
    const outRoot = join(__dirname, "..", "dist", "songs", safeSong);
    try {
      const { segmentSong } = await import("./lib/segment.js");
      await segmentSong({ inputDir, id: safeSong, title, artist, bitrate, outRoot });
      await uploadDir(outRoot, BUCKET, `songs/${safeSong}`);
      const catalog = await refresh();
      return send(res, 201, { ok: true, id: safeSong, songCount: catalog.songs.length });
    } finally {
      await rm(inputDir, { recursive: true, force: true });
      await rm(outRoot, { recursive: true, force: true });
    }
  }

  // PATCH /api/songs/:id  { title?, artist?, stemOrder? }
  if (req.method === "PATCH" && parts[1] === "songs" && parts.length === 3) {
    const id = safeId(parts[2]);
    const { title, artist, stemOrder } = await readJson(req);
    let manifest = await readRemoteManifest(BUCKET, id);   // always operate on current remote state
    if (title !== undefined || artist !== undefined) manifest = editMeta(manifest, { title, artist });
    if (Array.isArray(stemOrder)) manifest = reorderStems(manifest, stemOrder.map(safeId));
    await updateRemoteManifest(BUCKET, id, manifest);
    const catalog = await refresh();
    return send(res, 200, { ok: true, songCount: catalog.songs.length });
  }

  // DELETE /api/songs/:id
  if (req.method === "DELETE" && parts[1] === "songs" && parts.length === 3) {
    const id = safeId(parts[2]);
    await deleteRemoteSong(BUCKET, id);   // purge whole tree
    const catalog = await refresh();      // catalog drops it (rebuilt from remaining manifests)
    return send(res, 200, { ok: true, songCount: catalog.songs.length });
  }

  // POST /api/songs/:id/stems  { uploadId, filename, name }
  if (req.method === "POST" && parts[1] === "songs" && parts[3] === "stems" && parts.length === 4) {
    const id = safeId(parts[2]);
    const { uploadId, filename, name } = await readJson(req);
    const safeUp = safeId(uploadId), fname = safeFilename(filename);
    const { toSlug } = await import("./lib/slug.js");
    const slug = toSlug(name);
    if (!slug) return sendError(res, 400, `name "${name}" produces an empty slug`);
    const manifest = await readRemoteManifest(BUCKET, id);
    if (manifest.stems.some((s) => s.slug === slug)) return sendError(res, 409, `stem "${slug}" already exists`);

    const inputFile = join(TMP_ROOT, safeUp, fname);
    // add-stem segments ONLY the new stem into outRoot/<slug> and uploads ONLY that
    // subdir — it does not touch or re-download the song's existing stems.
    const outRoot = join(__dirname, "..", "dist", "songs", id);
    try {
      const { segmentStem } = await import("./lib/segment.js");
      const { probeDuration } = await import("./lib/media.js");
      // Segments into outRoot/<slug>/<rev>/; uploading outRoot/<slug> recursively lands the rev
      // folder at songs/<id>/<slug>/<rev>/…. The manifest points at that versioned path.
      const { rev } = await segmentStem({ file: inputFile, slug, outRoot });
      const seconds = await probeDuration(inputFile);
      await uploadDir(join(outRoot, slug), BUCKET, `songs/${id}/${slug}`);
      const next = addStem(manifest, { name, slug, seconds, rev, src: `${slug}/${rev}/audio.m3u8`, waveform: `${slug}/${rev}/waveform.json` });
      await updateRemoteManifest(BUCKET, id, next);
      await refresh();
      return send(res, 201, { ok: true, slug });
    } finally {
      await rm(join(TMP_ROOT, safeUp), { recursive: true, force: true });
      await rm(outRoot, { recursive: true, force: true });
    }
  }

  // PATCH /api/songs/:id/stems/:slug  { name }
  if (req.method === "PATCH" && parts[1] === "songs" && parts[3] === "stems" && parts.length === 5) {
    const id = safeId(parts[2]), slug = safeId(parts[4]);
    const { name } = await readJson(req);
    const manifest = await readRemoteManifest(BUCKET, id);
    const next = renameStem(manifest, slug, name);  // throws on unknown/empty
    await updateRemoteManifest(BUCKET, id, next);
    await refresh();
    return send(res, 200, { ok: true });
  }

  // DELETE /api/songs/:id/stems/:slug  — manifest first, then purge files
  if (req.method === "DELETE" && parts[1] === "songs" && parts[3] === "stems" && parts.length === 5) {
    const id = safeId(parts[2]), slug = safeId(parts[4]);
    const manifest = await readRemoteManifest(BUCKET, id);
    const next = removeStem(manifest, slug);        // throws on unknown / last stem
    await updateRemoteManifest(BUCKET, id, next);    // clean manifest first (no dangling entry)
    await deleteRemoteStem(BUCKET, id, slug);        // then remove the now-orphaned files
    await refresh();
    return send(res, 200, { ok: true });
  }

  return sendError(res, 404, `no route for ${req.method} ${pathname}`);
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (!pathname.startsWith("/api/")) return serveStatic(res, pathname);
    return await route(req, res, pathname);
  } catch (e) {
    sendError(res, 500, e.message);
  }
});

await sweepTempDirs();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Stem Admin → http://127.0.0.1:${PORT}  (bucket: ${BUCKET})`);
});

export { server };
