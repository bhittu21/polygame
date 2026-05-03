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

// ─── ROOM REGISTRY ────────────────────────────────────────────
const rooms = {};   // code -> { players:{}, colorIdx:0 }

function getRoom(code) {
  if (!rooms[code]) rooms[code] = { players: {}, colorIdx: 0 };
  return rooms[code];
}
function cleanRoom(code) {
  if (code === 'global') return;
  const r = rooms[code];
  if (r && Object.keys(r.players).length === 0) delete rooms[code];
}

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

function randomSpawn() { return SPAWN_POINTS[Math.floor(Math.random()*SPAWN_POINTS.length)]; }
function colorFor(i)   { return COLORS[i % COLORS.length]; }
function scorePayload(room) {
  return Object.values(room.players).map(p=>({
    id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,
    health:p.health,color:p.color,alive:p.alive,
  }));
}

// ─── SOCKETS ──────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('join', (data) => {
    const raw  = typeof data.room==='string' ? data.room.trim() : '';
    const code = raw ? raw.toUpperCase().substring(0,8) : 'global';
    socket.roomCode = code;
    socket.join(code);

    const room = getRoom(code);
    const sp   = randomSpawn();
    const name = (typeof data.name==='string' && data.name.trim())
                  ? data.name.trim().substring(0,16)
                  : 'Ghost'+Math.floor(Math.random()*9999);

    room.players[socket.id] = {
      id:socket.id, name, color:colorFor(room.colorIdx++),
      x:sp.x, y:PLAYER_HEIGHT, z:sp.z, rotY:0,
      health:100, kills:0, deaths:0, alive:true,
    };

    socket.emit('init', { id:socket.id, players:room.players, roomCode:code });
    socket.to(code).emit('playerJoined', room.players[socket.id]);
    io.to(code).emit('updateScores', scorePayload(room));
  });

  socket.on('move', (data) => {
    const room = rooms[socket.roomCode]; if (!room) return;
    const p = room.players[socket.id];  if (!p||!p.alive) return;
    p.x    = typeof data.x==='number'    ? data.x    : p.x;
    p.y    = PLAYER_HEIGHT;
    p.z    = typeof data.z==='number'    ? data.z    : p.z;
    p.rotY = typeof data.rotY==='number' ? data.rotY : p.rotY;
    socket.to(socket.roomCode).emit('playerMoved',{id:socket.id,x:p.x,y:p.y,z:p.z,rotY:p.rotY});
  });

  socket.on('shoot', (data) => {
    const room    = rooms[socket.roomCode]; if (!room) return;
    const shooter = room.players[socket.id];
    const target  = room.players[data.targetId];
    if (!shooter||!shooter.alive||!target||!target.alive) return;

    const dmg = Math.min(Math.max(Number(data.damage)||0, 0), 100);
    target.health -= dmg;
    io.to(data.targetId).emit('hit', { damage:dmg, from:socket.id });

    if (target.health <= 0) {
      target.health=0; target.alive=false; target.deaths++; shooter.kills++;
      io.to(socket.roomCode).emit('playerDied',{
        id:data.targetId, killerId:socket.id,
        killerName:shooter.name, victimName:target.name,
      });
      io.to(socket.roomCode).emit('updateScores', scorePayload(room));

      const roomCode=socket.roomCode, targetId=data.targetId;
      setTimeout(() => {
        const r=rooms[roomCode]; if (!r||!r.players[targetId]) return;
        const sp=randomSpawn(); const tp=r.players[targetId];
        tp.health=100; tp.alive=true;
        tp.x=sp.x; tp.y=PLAYER_HEIGHT; tp.z=sp.z;
        io.to(targetId).emit('respawn',{x:sp.x,y:PLAYER_HEIGHT,z:sp.z});
        io.to(roomCode).emit('playerRespawned',{id:targetId,x:sp.x,y:PLAYER_HEIGHT,z:sp.z});
        io.to(roomCode).emit('updateScores',scorePayload(r));
      }, RESPAWN_MS);
    } else {
      io.to(socket.roomCode).emit('updateScores', scorePayload(room));
    }
  });

  socket.on('disconnect', () => {
    const code=socket.roomCode;
    if (!code||!rooms[code]) return;
    delete rooms[code].players[socket.id];
    io.to(code).emit('playerLeft', socket.id);
    io.to(code).emit('updateScores', scorePayload(rooms[code]));
    cleanRoom(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`POLY ARENA on port ${PORT}`));
