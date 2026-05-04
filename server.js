'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── CONSTANTS ────────────────────────────────────────────────
const SPAWN_POINTS = [
  {x: 0,z: 0},{x:15,z:15},{x:-15,z:15},
  {x:15,z:-15},{x:-15,z:-15},{x:0,z:22},
  {x:0,z:-22},{x:22,z:0},{x:-22,z:0},
];
const COLORS = [
  '#ff4455','#44ddff','#ffcc22','#44ff88',
  '#ff88ff','#ff8844','#88ffcc','#aabbff',
];
const PLAYER_HEIGHT = 1.7;
const RESPAWN_MS    = 3000;
const DRAGON_MAX_HP = 500;
const DRAGON_DURATION = 40;   // seconds the dragon stays (if not killed)
const REGEN_AMOUNT  = 20;     // HP restored every 5 s

// ─── ROOM REGISTRY ────────────────────────────────────────────
const rooms = {};

function makeDragon() {
  return {
    active:     false,
    health:     0,
    maxHealth:  DRAGON_MAX_HP,
    nextIn:     65 + Math.random() * 55,  // seconds until first spawn
    startAngle: 0,
    spawnedAt:  0,       // Date.now() when spawned
  };
}

function getRoom(code) {
  if (!rooms[code]) rooms[code] = { players: {}, colorIdx: 0, dragon: makeDragon() };
  return rooms[code];
}
function cleanRoom(code) {
  if (code === 'global') return;
  const r = rooms[code];
  if (r && Object.keys(r.players).length === 0) delete rooms[code];
}

// ─── HELPERS ──────────────────────────────────────────────────
function randomSpawn() { return SPAWN_POINTS[Math.floor(Math.random()*SPAWN_POINTS.length)]; }
function colorFor(i)   { return COLORS[i % COLORS.length]; }
function clampNum(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function scorePayload(room) {
  return Object.values(room.players).map(p => ({
    id:p.id, name:p.name, kills:p.kills, deaths:p.deaths,
    health:p.health, color:p.color, alive:p.alive,
  }));
}

// ─── DRAGON SERVER LOGIC ──────────────────────────────────────
function spawnDragonRoom(code, room) {
  const d = room.dragon;
  d.active     = true;
  d.health     = DRAGON_MAX_HP;
  d.startAngle = Math.random() * Math.PI * 2;
  d.spawnedAt  = Date.now();
  io.to(code).emit('dragonSpawn', {
    startAngle: d.startAngle,
    elapsed:    0,
    health:     d.health,
    maxHealth:  d.maxHealth,
  });
}

function despawnDragonRoom(code, room, killed, killerName) {
  const d = room.dragon;
  d.active  = false;
  d.nextIn  = 60 + Math.random() * 60;
  io.to(code).emit('dragonDespawn', { killed: !!killed, killerName: killerName || '' });
}

// ─── SERVER TICKERS ───────────────────────────────────────────

// Dragon tick — every 1 second
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (Object.keys(room.players).length === 0) continue;
    const d = room.dragon;
    if (!d.active) {
      d.nextIn -= 1;
      if (d.nextIn <= 0) spawnDragonRoom(code, room);
    } else {
      const elapsed = (now - d.spawnedAt) / 1000;
      if (elapsed >= DRAGON_DURATION) despawnDragonRoom(code, room, false, null);
    }
  }
}, 1000);

// Health regen — every 5 seconds
setInterval(() => {
  for (const [code, room] of Object.entries(rooms)) {
    let changed = false;
    for (const p of Object.values(room.players)) {
      if (p.alive && p.health > 0 && p.health < 100) {
        p.health = Math.min(100, p.health + REGEN_AMOUNT);
        changed = true;
      }
    }
    if (changed) io.to(code).emit('updateScores', scorePayload(room));
  }
}, 5000);

// ─── SOCKETS ──────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── join ──────────────────────────────────────────────────
  socket.on('join', (data) => {
    const raw  = typeof data.room === 'string' ? data.room.trim() : '';
    const code = raw ? raw.toUpperCase().substring(0, 8) : 'global';
    socket.roomCode = code;
    socket.join(code);

    const room = getRoom(code);
    const sp   = randomSpawn();
    const name = (typeof data.name === 'string' && data.name.trim())
                  ? data.name.trim().substring(0, 16)
                  : 'Ghost' + Math.floor(Math.random() * 9999);

    room.players[socket.id] = {
      id: socket.id, name, color: colorFor(room.colorIdx++),
      x: sp.x, y: PLAYER_HEIGHT, z: sp.z, rotY: 0, weaponIdx: 0,
      health: 100, kills: 0, deaths: 0, alive: true,
    };

    // Send current dragon state if active
    const dragonInit = room.dragon.active ? {
      startAngle: room.dragon.startAngle,
      elapsed:    (Date.now() - room.dragon.spawnedAt) / 1000,
      health:     room.dragon.health,
      maxHealth:  room.dragon.maxHealth,
    } : null;

    socket.emit('init', { id: socket.id, players: room.players, roomCode: code, dragon: dragonInit });
    socket.to(code).emit('playerJoined', room.players[socket.id]);
    io.to(code).emit('updateScores', scorePayload(room));
  });

  // ── move ──────────────────────────────────────────────────
  socket.on('move', (data) => {
    const room = rooms[socket.roomCode]; if (!room) return;
    const p = room.players[socket.id];  if (!p || !p.alive) return;

    p.x         = typeof data.x === 'number'         ? data.x         : p.x;
    p.y         = clampNum(typeof data.y === 'number' ? data.y : PLAYER_HEIGHT, PLAYER_HEIGHT - 0.1, PLAYER_HEIGHT + 7);
    p.z         = typeof data.z === 'number'         ? data.z         : p.z;
    p.rotY      = typeof data.rotY === 'number'      ? data.rotY      : p.rotY;
    p.weaponIdx = typeof data.weaponIdx === 'number' ? data.weaponIdx : 0;

    socket.to(socket.roomCode).emit('playerMoved', {
      id: socket.id, x: p.x, y: p.y, z: p.z, rotY: p.rotY, weaponIdx: p.weaponIdx,
    });
  });

  // ── shoot player ──────────────────────────────────────────
  socket.on('shoot', (data) => {
    const room    = rooms[socket.roomCode]; if (!room) return;
    const shooter = room.players[socket.id];
    const target  = room.players[data.targetId];
    if (!shooter || !shooter.alive || !target || !target.alive) return;

    const dmg = clampNum(Number(data.damage) || 0, 0, 100);
    target.health -= dmg;
    io.to(data.targetId).emit('hit', { damage: dmg, from: socket.id });

    if (target.health <= 0) {
      target.health = 0; target.alive = false; target.deaths++; shooter.kills++;
      io.to(socket.roomCode).emit('playerDied', {
        id: data.targetId, killerId: socket.id,
        killerName: shooter.name, victimName: target.name,
      });
      io.to(socket.roomCode).emit('updateScores', scorePayload(room));

      const roomCode = socket.roomCode, targetId = data.targetId;
      setTimeout(() => {
        const r = rooms[roomCode]; if (!r || !r.players[targetId]) return;
        const sp = randomSpawn(); const tp = r.players[targetId];
        tp.health = 100; tp.alive = true;
        tp.x = sp.x; tp.y = PLAYER_HEIGHT; tp.z = sp.z;
        io.to(targetId).emit('respawn', { x: sp.x, y: PLAYER_HEIGHT, z: sp.z });
        io.to(roomCode).emit('playerRespawned', { id: targetId, x: sp.x, y: PLAYER_HEIGHT, z: sp.z });
        io.to(roomCode).emit('updateScores', scorePayload(r));
      }, RESPAWN_MS);
    } else {
      io.to(socket.roomCode).emit('updateScores', scorePayload(room));
    }
  });

  // ── shoot dragon ──────────────────────────────────────────
  socket.on('shootDragon', (data) => {
    const room = rooms[socket.roomCode]; if (!room) return;
    const d    = room.dragon;            if (!d.active) return;
    const shooter = room.players[socket.id];
    if (!shooter || !shooter.alive) return;

    const dmg = clampNum(Number(data.damage) || 0, 0, 100);
    d.health -= dmg;
    const hp = Math.max(0, d.health);

    io.to(socket.roomCode).emit('dragonHit', {
      hp, maxHp: d.maxHealth,
      shooterName: shooter.name,
    });

    if (d.health <= 0) {
      // Bonus kill credit to shooter
      shooter.kills += 3;
      io.to(socket.roomCode).emit('updateScores', scorePayload(room));
      despawnDragonRoom(socket.roomCode, room, true, shooter.name);
    }
  });

  // ── disconnect ────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    delete rooms[code].players[socket.id];
    io.to(code).emit('playerLeft', socket.id);
    io.to(code).emit('updateScores', scorePayload(rooms[code]));
    cleanRoom(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`POLY ARENA v3 on port ${PORT}`));
