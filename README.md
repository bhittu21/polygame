# POLY ARENA 🎮

> **A browser-based multiplayer low-poly FPS — no downloads, no installs. Just click and fight.**

[![Play Now](https://img.shields.io/badge/PLAY%20NOW-Live%20Game-00ff41?style=for-the-badge&logo=googlechrome&logoColor=black)](http://sheikhabirali.me/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r128-black?style=for-the-badge&logo=three.js)](https://threejs.org/)

---

## 🕹️ Play Online

**➜ [sheikhabirali.me](http://sheikhabirali.me/)**

No account required. Open the link, enter a callsign, and drop in.

---

## 📸 Overview

POLY ARENA is a real-time multiplayer first-person shooter built entirely with vanilla JavaScript, Three.js, and Socket.IO. It runs in any modern browser with zero setup for the player. The world is rendered in a stylized low-poly aesthetic with a full arena, cover, dynamic environment events, and procedural audio.

---

## ✨ Features

### 🔫 Combat
- **Dual weapon system** — Auto Rifle (full-auto, fast) and Sniper Rifle (high damage, bolt-action)
- **Scope / ADS** — Right-click to zoom; sniper shows a full scope overlay with crosshair reticle
- **Weapon switching** — Keys `1` / `2` or scroll wheel
- **Wall-blocking** — Bullets are physically blocked by solid obstacles (no shooting through walls)
- **Hit markers & kill feed** — Instant visual feedback on every hit and kill

### 🏃 Movement
- **WASD + Arrow keys** movement with smooth collision resolution
- **Sprint** — Hold `Shift` to move at 2× speed with faster gun bob
- **Footstep audio** — Procedural sounds that speed up when sprinting

### 🐉 Dragon Event
- Every 60–120 seconds a **dragon circles the arena**
- Full environment transition: fog thickens, ambient light turns blood-red, sun dims
- Accompanied by a procedural multi-layered roar
- Fades back to normal after 20 seconds

### 🌐 Multiplayer
- **Global public server** — jump in and play with anyone online
- **Private rooms** — generate a 6-character room code and share it with friends
- **Real-time interpolation** — remote players move smoothly with leg/arm animation
- **Live scoreboard** — holds `Tab` to view kills / deaths / HP for all players
- **Respawn system** — 3-second respawn timer with random spawn placement

### 🎨 Visuals & Audio
- Low-poly arena with walls, towers, crates, cover walls, and flanking barriers
- Decorative trees and procedurally placed mountains
- Matrix rain on the start screen
- Fully **procedural audio engine** (Web Audio API) — no audio files needed
- Scan-line overlay and green terminal HUD aesthetic

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| 3D Rendering | [Three.js r128](https://threejs.org/) |
| Networking | [Socket.IO](https://socket.io/) |
| Server | [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) |
| Audio | Web Audio API (procedural, no files) |
| Frontend | Vanilla JS, HTML5, CSS3 |

---

## 🚀 Self-Hosting

### Prerequisites
- Node.js 18+
- npm

### Run Locally

```bash
# 1. Clone the repo
git clone https://github.com/bhittu21/polygame.git
cd polygame

# 2. Install dependencies
npm install

# 3. Start the server
node server.js
```

Then open **http://localhost:3000** in your browser.

### Deploy

See [`DEPLOY.md`](DEPLOY.md) for instructions on deploying to a VPS or cloud provider.

---

## 🎮 Controls

| Key / Button | Action |
|---|---|
| `W A S D` | Move |
| `Shift` | Sprint |
| `Mouse Move` | Look |
| `Left Click` | Shoot |
| `Right Click` | Scope / ADS |
| `1` / `2` | Select weapon |
| `Scroll Wheel` | Cycle weapon |
| `Tab` | Scoreboard |
| `Escape` | Release mouse |

> Click the game canvas to capture the mouse and enter combat mode.

---

## 📁 Project Structure

```
polygame/
├── public/
│   ├── index.html     # Game UI, HUD, start overlay
│   └── game.js        # Client engine (Three.js, input, audio, networking)
├── server.js          # Socket.IO game server (rooms, state, combat logic)
├── package.json
└── DEPLOY.md
```

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

---

## 👤 Author

**Sheikh Abir Ali**

[![Portfolio](https://img.shields.io/badge/Portfolio-sheikhabirali.netlify.app-00ff41?style=flat-square)](https://sheikhabirali.netlify.app/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-sheikhabirali-0077B5?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/sheikhabirali/)
[![Email](https://img.shields.io/badge/Email-sheikhabirali@gmail.com-D14836?style=flat-square&logo=gmail&logoColor=white)](mailto:sheikhabirali@gmail.com)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Made with ☕ and too many hours of debugging pointer lock events.
</p>
