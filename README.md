<div align="center">

<img src="title.png" alt="BouncEngine" width="360">

# BouncEngine 🌊

**A browser-based homage to the classic Nokia *Bounce* — reimagined with a liquid, Frutiger-Aero soul.**

Play glossy pixel-art levels, race the speedrun timer, build your own stages in the editor, and share them online. Installs as an offline-capable PWA.

</div>

---

## ✨ Features

- 🎮 **Classic Bounce gameplay** — a fixed-timestep physics platformer rendered on a pixel-perfect canvas.
- 🌊 **Frutiger-Aero presentation** — glossy aqua UI, an audio-synced Nokia-style intro, and a gapless menu music loop.
- 🧱 **Level editor** — paint tiles, place spiders, set spawns and doors, then save locally or publish online.
- 🌐 **Online levels** — browse, search, and play community creations; like and view tracking.
- 📶 **Progressive Web App** — installs to your device and runs fully offline via a service worker.
- 🏁 **Speedrun mode** — per-level best times.

## 🕹️ How to play

- **PLAY** → pick a level pack → jump, bounce, and reach the door.
- **ONLINE** → browse and play community levels.
- **Editor** (from the account panel) → design and publish your own.

## 🗂️ Project structure

```
index.html          Menu / PWA shell — intro, music, level browser, account
sw.js               Service worker (offline cache + auto-updater)
progress.js         Level-unlock / progression tracking
storage.js          IndexedDB wrapper (BounceGameDB) for levels + autosave
site.webmanifest    PWA manifest

engine/             The game
  index.html          Boot, physics, software renderer, SFX, HUD
  assets.js           Texture atlases (base64)
  chunkManager.js     64×64 tile-chunk store
  levels.js           Built-in classic levels

editor/             The level editor (standalone page)
  index.html
  import_classic_levels.js
```

## 🧩 Tech

Vanilla HTML/CSS/JS — no framework. Canvas 2D **software rasterizer** (not WebGL), Web Audio API for music/SFX, IndexedDB for storage, and a service worker for offline + updates.

Online features (level library, accounts, likes/views) talk to a small REST API at `/api`. **That backend is kept in a separate private repository** — this repo is the game client.

## 🛠️ Running locally

Any static file server works, e.g.:

```bash
npx serve .
```

Then open the served URL. Online features need the `/api` backend running on the same origin; without it, offline single-player and the editor's local saves work fully.

## 🎵 Credits

Music and art credits are shown in-game (see the intro sequence). BouncEngine is a fan project and is **not affiliated with, endorsed by, or associated with Nokia**; "Bounce" is used only to describe the genre it pays tribute to.

## 📄 License

_See `LICENSE`._
