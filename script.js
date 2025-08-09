// script.js — Multiplayer Wordle (client)
// ================= CONFIG ===================
const PUSHER_KEY = "570abd9dffaf960c32a8";
const PUSHER_CLUSTER = "eu"; // e.g. "eu"
const SERVER_ENDPOINT = "https://wordle-server-ten.vercel.app/api/send"; // no double slash
// ===========================================

if (SERVER_ENDPOINT.includes("REPLACE") || PUSHER_KEY.includes("REPLACE")) {
  console.warn("Нужно настроить PUSHER_KEY / PUSHER_CLUSTER / SERVER_ENDPOINT в script.js");
}

// Pusher init
Pusher.logToConsole = false;
const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });

// UI nodes
const loginScreen = document.getElementById("login-screen");
const gameScreen = document.getElementById("game-screen");
const nicknameInput = document.getElementById("nickname");
const createBtn = document.getElementById("create-room");
const joinCodeInput = document.getElementById("join-code");
const joinBtn = document.getElementById("join-room");
const roomInfo = document.getElementById("room-info");
const playerCountEl = document.getElementById("playerCount");
const playerListEl = document.getElementById("playerList");
const boardEl = document.getElementById("board");
const messagesEl = document.getElementById("messages");
const hostControls = document.getElementById("host-controls");
const secretWordInput = document.getElementById("secret-word");
const startBtn = document.getElementById("start-game");
const leaveBtn = document.getElementById("leave-room");

// state
let nickname = "";
let roomCode = "";
let channel = null;
let isHost = false;
let secretWord = null; // only host keeps this
let players = []; // authoritative list stored by host and broadcast via players-updated
const MAX_PLAYERS = 10;
const MAX_ROWS = 6;
const WORD_LEN = 5;
let guesses = []; // array of {name, guess, result} for UI
let currentTyped = ""; // current guess being typed

// helpers
function genRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function showMessage(txt) {
  const d = document.createElement("div");
  d.textContent = txt;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function setHeader() {
  roomInfo.textContent = `Комната: ${roomCode}`;
  playerCountEl.textContent = `Игроки: ${players.length}/${MAX_PLAYERS}`;
}
function renderPlayers() {
  playerListEl.innerHTML = players.map(n => `<li>${escapeHtml(n)}</li>`).join("");
  setHeader();
}
function escapeHtml(s){ if(!s) return ""; return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

// build empty board
function createBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < MAX_ROWS; r++) {
    const row = document.createElement("div");
    row.className = "row";
    for (let c = 0; c < WORD_LEN; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      row.appendChild(cell);
    }
    boardEl.appendChild(row);
  }
}

// update a row text (without colors)
function updateRowText(rowIndex, text) {
  const rows = boardEl.getElementsByClassName("row");
  if (!rows[rowIndex]) return;
  const cells = rows[rowIndex].getElementsByClassName("cell");
  for (let i = 0; i < WORD_LEN; i++) {
    cells[i].textContent = (text[i] || "").toUpperCase();
    cells[i].classList.remove("filled");
    if (text[i]) cells[i].classList.add("filled");
  }
}

// colorize according to result array like ['green','gray','yellow',...]
function colorizeRow(rowIndex, result) {
  const rows = boardEl.getElementsByClassName("row");
  if (!rows[rowIndex]) return;
  const cells = rows[rowIndex].getElementsByClassName("cell");
  for (let i = 0; i < WORD_LEN; i++) {
    cells[i].classList.remove("green","yellow","gray");
    if (result[i] === "green") cells[i].classList.add("green");
    else if (result[i] === "yellow") cells[i].classList.add("yellow");
    else cells[i].classList.add("gray");
  }
}

// POST to serverless to trigger pusher
async function sendEvent(event, data) {
  if (SERVER_ENDPOINT.includes("REPLACE")) {
    console.error("SERVER_ENDPOINT не настроен");
    return;
  }
  try {
    const res = await fetch(SERVER_ENDPOINT, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ channel: `room-${roomCode}`, event, data })
    });
    if (!res.ok) {
      console.error("sendEvent error", res.status, await res.text());
    }
  } catch (e) {
    console.error("sendEvent fetch failed", e);
  }
}

// Wordle checking logic (host only). Returns array of 'green'|'yellow'|'gray'
function evaluateGuess(secret, guess) {
  secret = secret.toLowerCase();
  guess = guess.toLowerCase();
  const res = Array(WORD_LEN).fill("gray");
  const secretCounts = {};

  // count letters in secret (excluding greens)
  for (let i = 0; i < WORD_LEN; i++) {
    const s = secret[i];
    if (s !== guess[i]) {
      secretCounts[s] = (secretCounts[s] || 0) + 1;
    }
  }

  // first pass: greens
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === secret[i]) res[i] = "green";
  }
  // second pass: yellows using counts
  for (let i = 0; i < WORD_LEN; i++) {
    if (res[i] === "green") continue;
    const g = guess[i];
    if (secretCounts[g] > 0) {
      res[i] = "yellow";
      secretCounts[g]--;
    } else {
      res[i] = "gray";
    }
  }
  return res;
}

// Pusher subscription + binds
function subscribeToRoom(code) {
  roomCode = code.toUpperCase();
  channel = pusher.subscribe(`room-${roomCode}`);

  channel.bind("players-updated", data => {
    players = Array.isArray(data.players) ? data.players.slice(0, MAX_PLAYERS) : players;
    renderPlayers();
  });

  channel.bind("player-joined", data => {
    // If host, maintain authoritative list and broadcast players-updated
    if (isHost) {
      if (!players.includes(data.name)) players.push(data.name);
      // cap to MAX_PLAYERS
      if (players.length > MAX_PLAYERS) players = players.slice(0, MAX_PLAYERS);
      sendEvent("players-updated", { players });
    } else {
      // non-host just shows join notice (host will send players-updated)
      showMessage(`${data.name} присоединился`);
    }
  });

  channel.bind("player-left", data => {
    if (isHost) {
      players = players.filter(n => n !== data.name);
      sendEvent("players-updated", { players });
    } else {
      showMessage(`${data.name} покинул комнату`);
    }
  });

  // Host sets the word => we receive only notification that round started
  channel.bind("game-started", data => {
    // Do NOT rely on data.word (host should not broadcast it). It's just a signal.
    createBoard();
    guesses = [];
    currentTyped = "";
    showMessage("Раунд начался! Вводите слова (5 букв).");
  });

  // A player submitted a guess to the host — host will evaluate and broadcast result.
  channel.bind("guess-result", data => {
    // data = {name, guess, result: ['green',...], rowIndex}
    guesses.push({ name: data.name, guess: data.guess, result: data.result });
    const rowIndex = guesses.length - 1;
    updateRowText(rowIndex, data.guess);
    colorizeRow(rowIndex, data.result);
    showMessage(`${data.name} → ${data.guess.toUpperCase()}`);

    if (data.result.every(c => c === "green")) {
      // winner announced by host via winner event too
      showMessage(`🎉 Победитель: ${data.name}! Слово: скрыто (только у хоста)`);
    }
  });

  // Host broadcasts winner (text)
  channel.bind("winner", data => {
    showMessage(`🎉 Победитель: ${data.name}! Загаданное слово: ${data.word.toUpperCase()}`);
  });

  // basic UI show
  loginScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  setHeader();
  createBoard();
  showMessage(`Вы в комнате ${roomCode}. Ожидание хоста / начало раунда.`);
}

// UI actions
createBtn.addEventListener("click", async () => {
  nickname = nicknameInput.value.trim();
  if (!nickname) return alert("Введите ник.");
  isHost = true;
  roomCode = genRoomCode();
  // host is first player
  players = [nickname];
  subscribeToRoom(roomCode);
  hostControls.classList.remove("hidden");
  // announce join to let other clients (if any) know — host also broadcasts players-updated
  await sendEvent("player-joined", { name: nickname });
  await sendEvent("players-updated", { players });
});

joinBtn.addEventListener("click", async () => {
  nickname = nicknameInput.value.trim();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!nickname || !code) return alert("Введите ник и код комнаты.");
  roomCode = code;
  isHost = false;
  subscribeToRoom(roomCode);
  // announce to host and others
  await sendEvent("player-joined", { name: nickname });
});

// Host starts game (sets secret word locally)
startBtn.addEventListener("click", async () => {
  if (!isHost) return;
  const w = secretWordInput.value.trim().toLowerCase();
  if (!w || w.length !== WORD_LEN) return alert("Слово должно быть из 5 букв.");
  secretWord = w;
  // Clear board and alert players — DO NOT include the secret word in broadcast
  guesses = [];
  createBoard();
  await sendEvent("game-started", { startedBy: nickname });
  showMessage("Вы задали слово. Игра началась.");
});

// leave
leaveBtn.addEventListener("click", async () => {
  if (!roomCode || !nickname) return;
  await sendEvent("player-left", { name: nickname });
  // cleanup UI
  location.reload();
});

// typing and enter handling
document.addEventListener("keydown", async (e) => {
  if (!channel || !roomCode) return;
  // if board full, ignore
  if (guesses.length >= MAX_ROWS) return;
  if (e.key === "Backspace") {
    if (currentTyped.length > 0) currentTyped = currentTyped.slice(0, -1);
    updateRowText(guesses.length, currentTyped);
    return;
  }
  if (e.key === "Enter") {
    if (currentTyped.length !== WORD_LEN) return showMessage("Нужно ввести 5 букв.");
    // submit guess: send to host for evaluation
    await sendEvent("guess-submitted", { name: nickname, guess: currentTyped });
    // lock typed until host result arrives
    currentTyped = "";
    return;
  }
  // only latin letters and cyrillic suppressed; accept english letters only ideally
  const ch = e.key;
  if (/^[a-zA-Z]$/.test(ch) && currentTyped.length < WORD_LEN) {
    currentTyped += ch.toLowerCase();
    updateRowText(guesses.length, currentTyped);
  }
});

// Host: listen for guess-submitted and evaluate
function hostBindForEvaluations() {
  if (!isHost || !channel) return;
  channel.bind("guess-submitted", async (data) => {
    // data: {name, guess}
    // Authoritative evaluation only on host
    if (!secretWord) {
      // if host hasn't set a word yet, ignore or notify
      await sendEvent("message", { text: "Хост не задал слово." });
      return;
    }

    const result = evaluateGuess(secretWord, data.guess);
    // row index = current number of guesses among all clients (host uses local guesses length)
    const rowIndex = guesses.length; // host's local count
    // broadcast guess-result
    await sendEvent("guess-result", { name: data.name, guess: data.guess, result, rowIndex });
    // store in host's history
    guesses.push({ name: data.name, guess: data.guess, result });

    if (result.every(x => x === "green")) {
      // announce winner and reveal word
      await sendEvent("winner", { name: data.name, word: secretWord });
      // optionally reset secretWord or keep until host sets new word
      secretWord = null;
      // host can prompt for new word
      showMessage(`Раунд завершён. Победил ${data.name}.`);
      hostControls.classList.remove("hidden");
    }
  });
}

// Also host should handle players-updated requests if any (we already broadcast on join/leave)
// But bind host evaluation on subscription ready:
function waitForSubscriptionAndBind() {
  // pusher.bind_global not in this lib; we'll detect channel presence by small delay
  setTimeout(() => {
    if (isHost) hostBindForEvaluations();
  }, 500);
}

// When receiving players-updated we already update UI (see binds). For initial local join we request players list by notifying join to host.

// Before unload — attempt to notify
window.addEventListener("beforeunload", () => {
  if (roomCode && nickname) {
    // best-effort
    navigator.sendBeacon && navigator.sendBeacon(SERVER_ENDPOINT, JSON.stringify({
      channel: `room-${roomCode}`, event: "player-left", data: { name: nickname }
    }));
  }
});

// On page load: init board and possibly restore nickname
(function init() {
  createBoard();
  const saved = localStorage.getItem("wordle_nick");
  if (saved) nicknameInput.value = saved;
  // auto-detect if ?room=CODE in URL
  const params = new URLSearchParams(location.search);
  const code = params.get("room");
  if (code) {
    // if we have room in URL, auto-fill join code
    joinCodeInput.value = code.toUpperCase();
  }
  // subscribe readiness
  waitForSubscriptionAndBind();
})();

// store nickname when typed
nicknameInput.addEventListener("change", () => {
  localStorage.setItem("wordle_nick", nicknameInput.value.trim());
});
