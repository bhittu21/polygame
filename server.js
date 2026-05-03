'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 10000
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── GAME STATE ───────────────────────────────────────────────
const players = {};

const SPAWN_POINTS = [
  { x: 0,   z: 0   },
  { x: 15,  z: 15  },
  { x: -15, z: 15  },
  { x: 15,  z: -15 },
  { x: -15, z: -15 },
  { x: 0,   z: 22  },
  { x: 0,   z: -22 },
  { x: 22,  z: 0   },
  { x: -22, z: 0   },
];

const COLORS = [
  '#ff4455', '#44ddff', '#ffcc22', '#44ff88',
  '#ff88ff', '#ff8844', '#88ffcc', '#aabbff',
];

const PLAYER_HEIGHT = 1.7;
const RESPAWN_DELAY = 3000; // ms

function randomSpawn() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

function colorFor(index) {
  return COLORS[index % COLORS.length];
}

function scorePayload() {
  return Object.values(players).map(p => ({
    id:     p.id,
    name:   p.name,
    kills:  p.kills,
    deaths: p.deaths,
    health: p.health,
    color:  p.color,
    alive:  p.alive,
  }));
}

// ─── SOCKET LOGIC ─────────────────────────────────────────────
io.on('connection', (socket) => {

  // Client sends name before we initialise them
  socket.on('join', (data) => {
    const sp    = randomSpawn();
    const idx   = Object.keys(players).length;
    const color = colorFor(idx);
    const name  = (typeof data.name === 'string' && data.name.trim())
                    ? data.name.trim().substring(0, 16)
                    : `Player${Math.floor(Math.random() * 9999)}`;

    players[socket.id] = {
      id: socket.id,
      name,
      color,
      x: sp.x,
      y: PLAYER_HEIGHT,
      z: sp.z,
      rotY: 0,
      health: 100,
      kills: 0,
      deaths: 0,
      alive: true,
    };

    // Send full state to the new player
    socket.emit('init', { id: socket.id, players });

    // Tell everyone else
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Update scoreboard for all
    io.emit('updateScores', scorePayload());
  });

  // ── Movement ──────────────────────────────────────────────
  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;

    p.x    = typeof data.x    === 'number' ? data.x    : p.x;
    p.y    = PLAYER_HEIGHT;
    p.z    = typeof data.z    === 'number' ? data.z    : p.z;
    p.rotY = typeof data.rotY === 'number' ? data.rotY : p.rotY;

    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      x: p.x, y: p.y, z: p.z,
      rotY: p.rotY,
    });
  });

  // ── Shooting (client-side hit detection) ──────────────────
  socket.on('shoot', (data) => {
    const shooter = players[socket.id];
    if (!shooter || !shooter.alive) return;

    const target = players[data.targetId];
    if (!target || !target.alive) return;

    const dmg = Math.min(Math.max(Number(data.damage) || 0, 0), 50); // clamp 0-50
    target.health -= dmg;

    // Notify the target they were hit
    io.to(data.targetId).emit('hit', { damage: dmg, from: socket.id });

    if (target.health <= 0) {
      target.health = 0;
      target.alive  = false;
      target.deaths += 1;
      shooter.kills += 1;

      io.emit('playerDied', {
        id:         data.targetId,
        killerId:   socket.id,
        killerName: shooter.name,
        victimName: target.name,
      });

      io.emit('updateScores', scorePayload());

      // Respawn after delay
      setTimeout(() => {
        if (!players[data.targetId]) return;
        const sp = randomSpawn();
        const tp = players[data.targetId];
        tp.health = 100;
        tp.alive  = true;
        tp.x = sp.x; tp.y = PLAYER_HEIGHT; tp.z = sp.z;

        io.to(data.targetId).emit('respawn', { x: sp.x, y: PLAYER_HEIGHT, z: sp.z });
        io.emit('playerRespawned', { id: data.targetId, x: sp.x, y: PLAYER_HEIGHT, z: sp.z });
        io.emit('updateScores', scorePayload());
      }, RESPAWN_DELAY);

    } else {
      io.emit('updateScores', scorePayload());
    }
  });

  // ── Disconnect ────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (players[socket.id]) {
      delete players[socket.id];
      io.emit('playerLeft', socket.id);
      io.emit('updateScores', scorePayload());
    }
  });
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`POLY ARENA running on port ${PORT}`);
});
