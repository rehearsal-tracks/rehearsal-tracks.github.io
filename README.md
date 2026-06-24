# Interactive Stem Player

A single-page, dependency-free stem player. Host your own stems, share one link,
and every listener gets their **own private mix** — volume sliders, mute, and solo
run entirely in their browser tab, so one person's adjustments never affect anyone
else's.

- 🎚️ Per-stem volume + mute/solo, master volume, seek, loop
- 🔒 Per-listener independence (state lives only in the visitor's browser)
- 📱 Works in Safari/Chrome/Firefox on phone, tablet, desktop — no app, no account
- 🪶 Plain MP3/WAV files, no build step, no server, no dependencies

A demo track (synthesized placeholder stems) ships in `stems/demo/` so the player
works the moment you open it. Replace it with your own music — see below.

---

## Run it locally

Audio loads over `fetch`, which browsers block from `file://`. Serve the folder
over HTTP:

```bash
cd interactive-stem-player
python3 -m http.server 8000
# open http://localhost:8000
```

(Any static server works — `npx serve`, etc.)

---

## Add your own track

1. **Export one audio file per stem** from your DAW — e.g. `drums.mp3`, `bass.mp3`,
   `guitar.mp3`, `vocals.mp3`. **All stems must be the same length** so they stay in
   sync. MP3 (smaller) or WAV both work.

2. **Drop them in a folder** under `stems/`, e.g. `stems/my-song/`.

3. **Add the track to `tracks.json`:**

   ```json
   {
     "tracks": [
       {
         "id": "my-song",
         "title": "My Song",
         "artist": "Andrew Bray",
         "stems": [
           { "name": "Drums",  "src": "stems/my-song/drums.mp3" },
           { "name": "Bass",   "src": "stems/my-song/bass.mp3" },
           { "name": "Guitar", "src": "stems/my-song/guitar.mp3" },
           { "name": "Vocals", "src": "stems/my-song/vocals.mp3", "volume": 0.8 }
         ]
       }
     ]
   }
   ```

   `volume` is optional (0–1, defaults to 0.9). Add more objects to the `tracks`
   array for multiple songs — a track picker appears automatically, and you can
   deep-link a track with `?track=my-song`.

That's the whole workflow: **drop files in a folder, edit one JSON file, deploy.**

---

## Deploy (GitHub Pages)

This repo is set up to publish straight from the `main` branch:

1. Push to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. Your link: `https://andrew-bray.github.io/interactive-stem-player`

The included empty `.nojekyll` file tells Pages to serve all files as-is.

> Prefer drag-and-drop? Netlify works too — drag this folder onto
> [app.netlify.com/drop](https://app.netlify.com/drop) for an instant URL.

---

## Regenerate the demo stems

```bash
python3 scripts/generate_demo_stems.py   # writes WAVs to stems/demo/
# then convert to mp3 (optional):
for f in drums bass chords lead; do ffmpeg -y -i stems/demo/$f.wav -b:a 128k stems/demo/$f.mp3; done
```

---

## Roadmap — waveforms later

Today the player uses the Web Audio API with simple sliders. Because each stem's
full `AudioBuffer` is already decoded in memory, scrolling waveforms can be drawn
**client-side on a `<canvas>`** from the same MP3s — no HLS preprocessing, no
extra files. That's the planned next step. (The `stemplayer-js` library offers
waveforms out of the box but requires converting every stem to HLS segments +
pre-generated waveform JSON, which breaks the drop-in-a-folder workflow — hence
the vanilla approach here.)

---

## How per-listener independence works

There is no server and no shared state. The page ships static audio files; all
mixing happens in `GainNode`s inside each visitor's own `AudioContext`. Two people
opening the same link hear whatever *they* set — the link is shared, the mix is not.
