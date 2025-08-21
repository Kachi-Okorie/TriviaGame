/**
 * Real-time Trivia Game Server
 * Features:
 * - Up to 6 players join with a name
 * - First-to-buzz locks the buzzer for others until host resets/next question
 * - Host pushes questions (multiple choice)
 * - Players submit answers in real time; host sees all responses live
 * - Auto scoring when host reveals correct answer (+10), optional buzz bonus (+5)
 * - Host can adjust scores, kick/reset players, and navigate questions
 */

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const QUESTIONS_PATH = path.join(__dirname, 'data', 'questions.json');

let gameState = {
  phase: 'lobby', // lobby | question | reveal | ended
  players: {}, // socketId -> { id, name, score, answer, hasBuzzed, connected }
  hostId: null,
  buzzedBy: null, // socketId of first buzzer
  qIndex: 0,
  timerRemaining: 0,
  _timerHandle: null,
  questions: [],
  maxPlayers: 6,
  settings: {
    pointsCorrect: 10,
    pointsBuzzBonus: 5,
    timerSeconds: 20,
    lockAnswersOnReveal: true
  }
};

function loadQuestions() {
  try {
    const raw = fs.readFileSync(QUESTIONS_PATH, 'utf-8');
    gameState.questions = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load questions:', e);
    gameState.questions = [];
  }
}
loadQuestions();

function resetRoundState() {
  gameState.buzzedBy = null;
  for (const pid of Object.keys(gameState.players)) {
    gameState.players[pid].answer = null;
    gameState.players[pid].hasBuzzed = false;
  }
}

function getPublicState() {
  const players = Object.values(gameState.players).map(p => ({
    id: p.id, name: p.name, score: p.score, hasBuzzed: p.hasBuzzed,
    // Do not leak answers to players during question phase
  }));
  return {
    phase: gameState.phase,
    players,
    qIndex: gameState.qIndex,
    buzzedBy: gameState.buzzedBy,
    questionCount: gameState.questions.length
  };
}

function getHostState() {
  const players = Object.values(gameState.players);
  const q = gameState.questions[gameState.qIndex] || null;
  return {
    ...getPublicState(),
    currentQuestion: q,
    playerAnswers: players.map(p => ({ id: p.id, name: p.name, answer: p.answer })),
    hostId: gameState.hostId
  };
}

function broadcastState() {
  // To players (without revealing answers)
  io.emit('state:update', getPublicState());
  // To host (with answers)
  if (gameState.hostId) {
    io.to(gameState.hostId).emit('host:update', getHostState());
  }
}

io.on('connection', (socket) => {
  // Distinguish host vs player via query param role
  const role = socket.handshake.query.role || 'player';
  if (role === 'host') {
    gameState.hostId = socket.id;
    console.log('Host connected', socket.id);
    socket.emit('host:connected', { ok: true });
    broadcastState();
  } else {
    console.log('Player connected', socket.id);
  }

  socket.on('player:join', (name, cb) => {
    if (Object.keys(gameState.players).length >= gameState.maxPlayers) {
      cb && cb({ ok: false, error: 'Game is full (6 players).' });
      return;
    }
    const player = {
      id: socket.id, name: String(name || 'Player').slice(0, 20),
      score: 0, answer: null, hasBuzzed: false, connected: true
    };
    gameState.players[socket.id] = player;
    cb && cb({ ok: true, player });
    broadcastState();
  });

  socket.on('player:buzz', () => {
    if (gameState.phase !== 'question') return;
    if (gameState.buzzedBy) return;
    if (!gameState.players[socket.id]) return;
    gameState.buzzedBy = socket.id;
    gameState.players[socket.id].hasBuzzed = true;
    io.emit('buzz:locked', { playerId: socket.id, name: gameState.players[socket.id].name });
    broadcastState();
  });

  socket.on('player:answer', (answer) => {
    if (gameState.phase !== 'question') return;
    const p = gameState.players[socket.id];
    if (!p) return;
    p.answer = String(answer || '').toUpperCase().trim();
    // Notify host live
    if (gameState.hostId) {
      io.to(gameState.hostId).emit('host:answerUpdate', { id: p.id, name: p.name, answer: p.answer });
    }
  });

  // Host controls
  socket.on('host:start', () => {
    if (socket.id !== gameState.hostId) return;
    gameState.phase = 'question';
    gameState.qIndex = 0;
    resetRoundState();
    startTimer();
    broadcastState();
  });

  socket.on('host:next', () => {
    if (socket.id !== gameState.hostId) return;
    if (gameState.qIndex < gameState.questions.length - 1) {
      gameState.qIndex += 1;
      gameState.phase = 'question';
      resetRoundState();
      startTimer();
      broadcastState();
    } else {
      gameState.phase = 'ended';
      stopTimer();
      broadcastState();
    }
  });

  socket.on('host:prev', () => {
    if (socket.id !== gameState.hostId) return;
    if (gameState.qIndex > 0) {
      gameState.qIndex -= 1;
      gameState.phase = 'question';
      resetRoundState();
      startTimer();
      broadcastState();
    }
  });

  socket.on('host:reveal', () => {
    if (socket.id !== gameState.hostId) return;
    stopTimer();
    gameState.phase = 'reveal';
    // Auto score
    const q = gameState.questions[gameState.qIndex];
    const correct = (q && q.correct || '').toUpperCase();
    Object.values(gameState.players).forEach(p => {
      if (p.answer && p.answer.toUpperCase() === correct) {
        let points = gameState.settings.pointsCorrect;
        if (gameState.buzzedBy === p.id) points += gameState.settings.pointsBuzzBonus;
        p.score += points;
      }
    });
    broadcastState();
  });

  socket.on('host:resetBuzz', () => {
    if (socket.id !== gameState.hostId) return;
    gameState.buzzedBy = null;
    Object.values(gameState.players).forEach(p => p.hasBuzzed = false);
    io.emit('buzz:reset');
    broadcastState();
  });

  socket.on('host:kick', (playerId) => {
    if (socket.id !== gameState.hostId) return;
    delete gameState.players[playerId];
    broadcastState();
  });

  socket.on('host:setScore', ({ playerId, score }) => {
    if (socket.id !== gameState.hostId) return;
    if (gameState.players[playerId]) {
      gameState.players[playerId].score = Number(score) || 0;
      broadcastState();
    }
  });

  socket.on('host:reloadQuestions', () => {
    if (socket.id !== gameState.hostId) return;
    loadQuestions();
    broadcastState();
  });

  socket.on('disconnect', () => {
    if (socket.id === gameState.hostId) {
      console.log('Host disconnected.');
      gameState.hostId = null;
    } else if (gameState.players[socket.id]) {
      console.log('Player disconnected:', socket.id);
      gameState.players[socket.id].connected = false;
      // Keep them in scoreboard; host can kick if needed
    }
    broadcastState();
  });
});

// API to fetch current question (players don't see answer)
app.get('/api/question', (req, res) => {
  const { qIndex } = gameState;
  const q = gameState.questions[qIndex] || null;
  if (!q) return res.json(null);
  const { correct, ...rest } = q;
  res.json(rest);
});

// Serve host and player pages
app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Trivia server running on port ${PORT}`);
  console.log(`Player page: /player`);
  console.log(`Host page:   /host`);
});

function stopTimer() {
  if (gameState._timerHandle) {
    clearInterval(gameState._timerHandle);
    gameState._timerHandle = null;
  }
}

function startTimer() {
  stopTimer();
  gameState.timerRemaining = gameState.settings.timerSeconds;
  io.emit('timer:tick', gameState.timerRemaining);
  gameState._timerHandle = setInterval(() => {
    gameState.timerRemaining -= 1;
    if (gameState.timerRemaining < 0) gameState.timerRemaining = 0;
    io.emit('timer:tick', gameState.timerRemaining);
    if (gameState.timerRemaining <= 0) {
      stopTimer();
      // Auto reveal & score on timeout
      gameState.phase = 'reveal';
      const q = gameState.questions[gameState.qIndex];
      const correct = (q && q.correct || '').toUpperCase();
      Object.values(gameState.players).forEach(p => {
        if (p.answer && p.answer.toUpperCase() === correct) {
          let points = gameState.settings.pointsCorrect;
          if (gameState.buzzedBy === p.id) points += gameState.settings.pointsBuzzBonus;
          p.score += points;
        }
      });
      broadcastState();
      io.emit('timer:ended');
    }
  }, 1000);
}
