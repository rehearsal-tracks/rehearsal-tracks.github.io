// scripts/admin/public/admin.js — vanilla admin UI for the stem catalog.
// Talks to the localhost server's JSON API; no framework, no build.

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  banner: $("#banner"),
  dropzone: $("#dropzone"),
  songList: $("#song-list"),
  editPanel: $("#edit-panel"),
  reload: $("#reload"),
  overlay: $("#overlay"),
  overlayMsg: $("#overlay-msg"),
};

// ---- helpers ---------------------------------------------------------------

function banner(msg, kind = "ok") {
  els.banner.textContent = msg;
  els.banner.className = `banner is-${kind}`;
  els.banner.hidden = false;
}
function clearBanner() { els.banner.hidden = true; }
function overlay(show, msg = "Working…") {
  els.overlayMsg.textContent = msg;
  els.overlay.hidden = !show;
}

// Mirror of scripts/lib/slug.js toSlug — keep in sync.
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function fmtDuration(seconds) {
  const t = Math.round(seconds || 0);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `${method} ${path} → ${res.status}`);
  return data;
}
async function putFile(uploadId, file) {
  const res = await fetch(`/api/upload/${uploadId}/${encodeURIComponent(file.name)}`, {
    method: "PUT",
    body: file,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`upload ${file.name}: ${t}`);
  }
}

// ---- song list -------------------------------------------------------------

async function loadCatalog() {
  els.songList.innerHTML = "";
  els.songList.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Loading…" }));
  try {
    const catalog = await api("GET", "/api/catalog");
    renderCatalog(catalog.songs || []);
  } catch (e) {
    els.songList.innerHTML = "";
    els.songList.append(Object.assign(document.createElement("p"), { className: "muted", textContent: `Couldn't load catalog: ${e.message}` }));
  }
}

function renderCatalog(songs) {
  els.songList.innerHTML = "";
  if (songs.length === 0) {
    els.songList.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "No songs yet — drop some audio above." }));
    return;
  }
  for (const song of songs) {
    const row = document.createElement("div");
    row.className = "song-row";

    const main = document.createElement("div");
    main.className = "song-row__main";
    const title = document.createElement("div");
    title.className = "song-row__title";
    title.textContent = song.title;
    const meta = document.createElement("div");
    meta.className = "song-row__meta";
    meta.textContent = [song.artist, fmtDuration(song.durationSeconds), `${song.stemCount} ${song.stemCount === 1 ? "stem" : "stems"}`].filter(Boolean).join(" · ");
    main.append(title, meta);

    const edit = Object.assign(document.createElement("button"), { className: "btn", textContent: "Edit" });
    edit.addEventListener("click", () => openEdit(song.id));

    const del = Object.assign(document.createElement("button"), { className: "btn btn--danger", textContent: "Delete" });
    attachConfirm(del, `Delete "${song.title}"?`, async () => {
      overlay(true, "Deleting song…");
      try { await api("DELETE", `/api/songs/${song.id}`); banner(`Deleted "${song.title}".`); await loadCatalog(); closeEdit(song.id); }
      catch (e) { banner(e.message, "error"); }
      finally { overlay(false); }
    });

    row.append(main, edit, del);
    els.songList.append(row);
  }
}

// Turns a button into a two-step inline confirm (no modal dialogs).
function attachConfirm(btn, prompt, onConfirm) {
  const original = btn.textContent;
  btn.addEventListener("click", () => {
    if (btn.dataset.armed) return;
    btn.dataset.armed = "1";
    btn.textContent = "Confirm";
    btn.title = prompt;
    const cancel = setTimeout(reset, 4000);
    const handler = async () => {
      clearTimeout(cancel);
      btn.removeEventListener("click", handler);
      reset();
      await onConfirm();
    };
    btn.addEventListener("click", handler, { once: true });
    function reset() { delete btn.dataset.armed; btn.textContent = original; btn.title = ""; }
  });
}

// ---- add song --------------------------------------------------------------

function audioFilesFrom(dataTransfer) {
  const exts = [".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a"];
  return [...dataTransfer.files].filter((f) => exts.some((e) => f.name.toLowerCase().endsWith(e)));
}

function wireDropzone(zone, onFiles) {
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("is-over");
    const files = audioFilesFrom(e.dataTransfer);
    if (files.length) onFiles(files);
    else banner("No audio files in that drop (wav/mp3/flac/aiff/m4a).", "error");
  });
}

wireDropzone(els.dropzone, showAddForm);

function showAddForm(files) {
  clearBanner();
  const defaultTitle = "";
  els.dropzone.innerHTML = "";
  const form = document.createElement("div");

  const count = Object.assign(document.createElement("p"), { className: "hint", textContent: `${files.length} stem file(s): ${files.map((f) => f.name).join(", ")}` });

  const titleField = field("Title", "text");
  const artistField = field("Artist", "text");
  const idField = field("ID (URL slug)", "text");
  titleField.input.value = defaultTitle;
  // keep id in sync with title until the user edits id directly
  let idTouched = false;
  idField.input.addEventListener("input", () => { idTouched = true; });
  titleField.input.addEventListener("input", () => { if (!idTouched) idField.input.value = slugify(titleField.input.value); });

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const submit = Object.assign(document.createElement("button"), { className: "btn btn--primary", textContent: "Segment + upload" });
  const cancel = Object.assign(document.createElement("button"), { className: "btn btn--ghost", textContent: "Cancel" });
  cancel.addEventListener("click", resetDropzone);
  submit.addEventListener("click", () => submitAddSong(files, { id: idField.input.value.trim(), title: titleField.input.value.trim(), artist: artistField.input.value.trim() }));
  actions.append(submit, cancel);

  form.append(count, titleField.wrap, artistField.wrap, idField.wrap, actions);
  els.dropzone.append(form);
}

function field(label, type) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lab = Object.assign(document.createElement("label"), { textContent: label });
  const input = Object.assign(document.createElement("input"), { type });
  wrap.append(lab, input);
  return { wrap, input, label };
}

function resetDropzone() {
  els.dropzone.innerHTML = `<p>Drop a folder's audio files here</p><p class="dropzone__sub">wav · mp3 · flac · aiff · m4a — number-prefix filenames (<code>01-…</code>) to set order</p>`;
}

async function submitAddSong(files, { id, title, artist }) {
  if (!id || !title || !artist) return banner("ID, title and artist are all required.", "error");
  const uploadId = "up-" + crypto.randomUUID().slice(0, 8);
  try {
    overlay(true, `Uploading ${files.length} file(s)…`);
    for (const f of files) await putFile(uploadId, f);
    overlay(true, "Segmenting + uploading to R2 (this can take a while)…");
    const r = await api("POST", "/api/songs", { uploadId, id, title, artist });
    banner(`Added "${title}" (${r.songCount} songs total).`);
    resetDropzone();
    await loadCatalog();
  } catch (e) {
    banner(e.message, "error");
  } finally {
    overlay(false);
  }
}

// ---- edit panel ------------------------------------------------------------

async function openEdit(id) {
  overlay(true, "Loading song…");
  let manifest;
  try { manifest = await api("GET", `/api/songs/${id}`); }
  catch (e) { overlay(false); return banner(e.message, "error"); }
  overlay(false);
  renderEdit(manifest);
  els.editPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEdit(id) {
  if (!id || els.editPanel.dataset.id === id) { els.editPanel.hidden = true; els.editPanel.innerHTML = ""; }
}

function renderEdit(manifest) {
  const id = manifest.id;
  els.editPanel.hidden = false;
  els.editPanel.dataset.id = id;
  els.editPanel.innerHTML = "";

  const head = document.createElement("div");
  head.className = "panel__head";
  head.append(Object.assign(document.createElement("h2"), { className: "panel__h", textContent: `Editing: ${id}` }));
  const close = Object.assign(document.createElement("button"), { className: "btn btn--ghost", textContent: "Close" });
  close.addEventListener("click", () => closeEdit(id));
  head.append(close);

  const titleField = field("Title", "text"); titleField.input.value = manifest.title;
  const artistField = field("Artist", "text"); artistField.input.value = manifest.artist;
  const saveMeta = Object.assign(document.createElement("button"), { className: "btn btn--primary", textContent: "Save title/artist" });
  saveMeta.addEventListener("click", async () => {
    overlay(true, "Saving…");
    try { await api("PATCH", `/api/songs/${id}`, { title: titleField.input.value.trim(), artist: artistField.input.value.trim() }); banner("Saved title/artist."); await loadCatalog(); }
    catch (e) { banner(e.message, "error"); }
    finally { overlay(false); }
  });

  const stemsLabel = Object.assign(document.createElement("p"), { className: "panel__h", textContent: "Stems — drag ☰ to reorder" });
  const stemRows = document.createElement("div");
  stemRows.className = "stem-rows";
  stemRows.id = "stem-rows";
  for (const stem of manifest.stems) stemRows.append(stemRow(id, stem));
  wireReorder(stemRows);

  const saveOrder = Object.assign(document.createElement("button"), { className: "btn", textContent: "Save order" });
  saveOrder.addEventListener("click", async () => {
    const order = [...stemRows.querySelectorAll(".stem-row")].map((r) => r.dataset.slug);
    overlay(true, "Saving order…");
    try { await api("PATCH", `/api/songs/${id}`, { stemOrder: order }); banner("Saved stem order."); }
    catch (e) { banner(e.message, "error"); if (/stale|set mismatch/i.test(e.message)) openEdit(id); }
    finally { overlay(false); }
  });

  // add-stem dropzone
  const addZone = document.createElement("div");
  addZone.className = "dropzone";
  addZone.tabIndex = 0;
  addZone.innerHTML = `<p>Drop one audio file to add a stem</p>`;
  wireDropzone(addZone, (files) => showAddStemForm(id, addZone, files[0]));

  els.editPanel.append(head, titleField.wrap, artistField.wrap, saveMeta, stemsLabel, stemRows, saveOrder, Object.assign(document.createElement("p"), { className: "panel__h", textContent: "Add a stem" }), addZone);
}

function stemRow(songId, stem) {
  const row = document.createElement("div");
  row.className = "stem-row";
  row.dataset.slug = stem.slug;
  row.draggable = true;

  const handle = Object.assign(document.createElement("span"), { className: "stem-row__handle", textContent: "☰", title: "Drag to reorder" });

  const name = Object.assign(document.createElement("input"), { className: "stem-row__name", value: stem.name });
  name.addEventListener("blur", async () => {
    const newName = name.value.trim();
    if (!newName || newName === stem.name) { name.value = stem.name; return; }
    overlay(true, "Renaming…");
    try { await api("PATCH", `/api/songs/${songId}/stems/${stem.slug}`, { name: newName }); stem.name = newName; banner(`Renamed to "${newName}".`); }
    catch (e) { banner(e.message, "error"); name.value = stem.name; }
    finally { overlay(false); }
  });

  const secs = Object.assign(document.createElement("span"), { className: "stem-row__secs", textContent: typeof stem.seconds === "number" ? fmtDuration(stem.seconds) : "" });

  const del = Object.assign(document.createElement("button"), { className: "btn btn--danger", textContent: "Delete" });
  attachConfirm(del, `Delete stem "${stem.name}"?`, async () => {
    overlay(true, "Deleting stem…");
    try { await api("DELETE", `/api/songs/${songId}/stems/${stem.slug}`); banner(`Deleted stem "${stem.name}".`); openEdit(songId); await loadCatalog(); }
    catch (e) { banner(e.message, "error"); }
    finally { overlay(false); }
  });

  row.append(handle, name, secs, del);
  return row;
}

// Native HTML5 drag-and-drop reordering of stem rows within the container.
function wireReorder(container) {
  let dragging = null;
  container.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".stem-row");
    if (!row) return;
    dragging = row; row.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  container.addEventListener("dragend", () => {
    if (dragging) dragging.classList.remove("is-dragging");
    container.querySelectorAll(".is-drop-target").forEach((r) => r.classList.remove("is-drop-target"));
    dragging = null;
  });
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    const over = e.target.closest(".stem-row");
    if (!over || over === dragging) return;
    container.querySelectorAll(".is-drop-target").forEach((r) => r.classList.remove("is-drop-target"));
    const rect = over.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    over.classList.add("is-drop-target");
    container.insertBefore(dragging, after ? over.nextSibling : over);
  });
}

function showAddStemForm(songId, zone, file) {
  zone.innerHTML = "";
  const count = Object.assign(document.createElement("p"), { className: "hint", textContent: `File: ${file.name}` });
  const nameField = field("Stem name", "text");
  nameField.input.value = file.name.replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]+/, "");
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const submit = Object.assign(document.createElement("button"), { className: "btn btn--primary", textContent: "Add stem" });
  const cancel = Object.assign(document.createElement("button"), { className: "btn btn--ghost", textContent: "Cancel" });
  cancel.addEventListener("click", () => { zone.innerHTML = `<p>Drop one audio file to add a stem</p>`; });
  submit.addEventListener("click", async () => {
    const name = nameField.input.value.trim();
    if (!name) return banner("Stem name is required.", "error");
    const uploadId = "up-" + crypto.randomUUID().slice(0, 8);
    try {
      overlay(true, "Uploading stem…");
      await putFile(uploadId, file);
      overlay(true, "Segmenting + uploading to R2…");
      await api("POST", `/api/songs/${songId}/stems`, { uploadId, filename: file.name, name });
      banner(`Added stem "${name}".`);
      openEdit(songId);
      await loadCatalog();
    } catch (e) { banner(e.message, "error"); }
    finally { overlay(false); }
  });
  actions.append(submit, cancel);
  zone.append(count, nameField.wrap, actions);
}

// ---- boot ------------------------------------------------------------------

els.reload.addEventListener("click", loadCatalog);
loadCatalog();
