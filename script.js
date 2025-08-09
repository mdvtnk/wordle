// script.js — Multiplayer Wordle (client) — обновлённая версия
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

// typing state for the current editable row
let currentTypedArr = Array(WORD_LEN).fill("");
let activeRowIndex = 0; // index of editable row (guesses.length)
let activeColIndex = 0; // cursor column within row (0..WORD_LEN-1)
let typingActive = false; // becomes true after user clicks a cell in active row
let pendingSubmit = false; // to avoid double submit while awaiting host result

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
    row.dataset.row = String(r);
    for (let c = 0; c < WORD_LEN; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.col = String(c);
      row.appendChild(cell);
    }
    boardEl.appendChild(row);
  }
  // reset typing state
  guesses = [];
  currentTypedArr = Array(WORD_LEN).fill("");
  activeRowIndex = 0;
  activeColIndex = 0;
  typingActive = false;
  pendingSubmit = false;
  updateActiveRowUI();
}

// update a row text (without colors)
function updateRowText(rowIndex, arr) {
  const rows = boardEl.getElementsByClassName("row");
  if (!rows[rowIndex]) return;
  const cells = rows[rowIndex].getElementsByClassName("cell");
  for (let i = 0; i < WORD_LEN; i++) {
    cells[i].textContent = (arr[i] || "").toUpperCase();
    cells[i].classList.remove("filled");
    if (arr[i]) cells[i].classList.add("filled");
  }
}

// colorize according to result array like ['green','gray','yellow',...]
function colorizeRow(rowIndex, result) {
  const rows = boardEl.getElementsByClassName("row");
  if (!rows[rowIndex]) return;
  const cells = rows[rowIndex].getElementsByClassName("cell");
  for (let i = 0; i < WORD_LEN; i++) {
    cells[i].classList.remove("green","yellow","gray","active");
    if (result[i] === "green") cells[i].classList.add("green");
    else if (result[i] === "yellow") cells[i].classList.add("yellow");
    else cells[i].classList.add("gray");
  }
}

// highlight the active cell/row visually
function updateActiveRowUI() {
  const rows = boardEl.getElementsByClassName("row");
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].getElementsByClassName("cell");
    for (let c = 0; c < cells.length; c++) {
      cells[c].classList.remove("active");
    }
  }
  // mark active row and active cell if typingActive
  if (rows[activeRowIndex]) {
    const cells = rows[activeRowIndex].getElementsByClassName("cell");
    for (let c = 0; c < cells.length; c++) {
      if (typingActive && c === activeColIndex) cells[c].classList.add("active");
    }
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
      if (players.length > MAX_PLAYERS) players = players.slice(0, MAX_PLAYERS);
      sendEvent("players-updated", { players });
    } else {
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

  // Host signals start (word is NOT broadcast)
  channel.bind("game-started", data => {
    // reset UI for a new round
    guesses = [];
    currentTypedArr = Array(WORD_LEN).fill("");
    activeRowIndex = 0;
    activeColIndex = 0;
    typingActive = false;
    pendingSubmit = false;
    createBoard(); // recreate board empties it
    showMessage("Раунд начался! Нажмите на клетку, чтобы начать ввод.");
  });

  // Host evaluates and broadcasts guess-result
  channel.bind("guess-result", data => {
    // data: { name, guess, result, rowIndex }
    const rowIndex = (typeof data.rowIndex === "number") ? data.rowIndex : guesses.length;
    guesses.push({ name: data.name, guess: data.guess, result: data.result });
    updateRowText(rowIndex, data.guess.split(""));
    colorizeRow(rowIndex, data.result);
    showMessage(`${data.name} → ${data.guess.toUpperCase()}`);

    // prepare next editable row
    activeRowIndex = guesses.length;
    currentTypedArr = Array(WORD_LEN).fill("");
    activeColIndex = 0;
    typingActive = false;
    pendingSubmit = false;
    updateActiveRowUI();

    if (data.result.every(c => c === "green")) {
      // winner announced by host via winner event too
      showMessage(`🎉 Победитель: ${data.name}!`);
    }
  });

  // Host broadcasts winner (text + revealed word)
  channel.bind("winner", data => {
    showMessage(`🎉 Победитель: ${data.name}! Загаданное слово: ${data.word.toUpperCase()}`);
    // after winner, next round will be started by host via game-started
  });

  // basic UI show
  loginScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  setHeader();
  createBoard();
  showMessage(`Вы в комнате ${roomCode}. Нажмите на клетку, чтобы начать ввод.`);
  // if isHost bind host-side handling
  if (isHost) hostBindForEvaluations();
}

// UI actions
createBtn.addEventListener("click", async () => {
  nickname = nicknameInput.value.trim();
  if (!nickname) return alert("Введите ник.");
  isHost = true;
  roomCode = genRoomCode();
  players = [nickname];
  subscribeToRoom(roomCode);
  hostControls.classList.remove("hidden");
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
  await sendEvent("player-joined", { name: nickname });
});

// Host starts game (sets secret word locally)
startBtn.addEventListener("click", async () => {
  if (!isHost) return;
  const w = secretWordInput.value.trim().toLowerCase();
  if (!w || w.length !== WORD_LEN) return alert("Слово должно быть из 5 букв.");
  secretWord = w;
  guesses = [];
  createBoard();
  await sendEvent("game-started", { startedBy: nickname });
  showMessage("Вы задали слово. Нажмите на клетку, чтобы игроки могли вводить.");
  hostControls.classList.add("hidden");
});

// leave
leaveBtn.addEventListener("click", async () => {
  if (!roomCode || !nickname) return;
  await sendEvent("player-left", { name: nickname });
  location.reload();
});

// ************* CLICK-TO-TYPE: клик по клетке включает ввод *************
boardEl.addEventListener("click", (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  const rowEl = cell.parentElement;
  const rowIndex = parseInt(rowEl.dataset.row, 10);
  const colIndex = parseInt(cell.dataset.col, 10);

  // only allow editing current editable row (next to fill)
  const editableRow = guesses.length;
  if (rowIndex !== editableRow) {
    // если кликнули по старой заполненной строке — ничего
    // можно сделать: перейти на текущую строку автоматически
    // но по требованию — включаем ввод только при клике в текущей строке
    showMessage("Кликните в текущую (пустую) строку для начала ввода.");
    return;
  }

  activeRowIndex = editableRow;
  activeColIndex = colIndex;
  typingActive = true;
  updateActiveRowUI();
});

// ************* KEY HANDLING: поддержка кириллицы + автоотправка *************
function isLetterChar(ch) {
  if (!ch) return false;
  // Latin A-Z and Cyrillic blocks (including ё)
  return /^[A-Za-z\u0400-\u04FF]$/u.test(ch);
}

document.addEventListener("keydown", async (e) => {
  // typing only after click on a cell
  if (!typingActive) return;

  // prevent actions if we've already sent and wait for result
  if (pendingSubmit) return;

  if (e.key === "Backspace") {
    // remove char at activeColIndex-1 (like normal backspace)
    // if current cell empty, move left; else clear current
    if (currentTypedArr[activeColIndex]) {
      currentTypedArr[activeColIndex] = "";
    } else {
      // move left if possible
      if (activeColIndex > 0) {
        activeColIndex--;
        currentTypedArr[activeColIndex] = "";
      }
    }
    updateRowText(activeRowIndex, currentTypedArr);
    updateActiveRowUI();
    e.preventDefault();
    return;
  }

  if (e.key === "Enter") {
    // submit only if row full
    if (currentTypedArr.every(ch => ch && ch.length > 0)) {
      await submitCurrentGuess();
    } else {
      showMessage("Нужно ввести 5 букв перед отправкой.");
    }
    e.preventDefault();
    return;
  }

  // accept letter if it is Latin or Cyrillic
  const key = e.key;
  if (isLetterChar(key) && currentTypedArr.filter(Boolean).length < WORD_LEN) {
    // insert at activeColIndex
    currentTypedArr[activeColIndex] = key.toLowerCase();
    // move cursor to next available position to the right
    let next = activeColIndex + 1;
    while (next < WORD_LEN && currentTypedArr[next]) next++;
    if (next <= WORD_LEN - 1) activeColIndex = next;
    // if we are at end and it's filled, place cursor at last index
    if (activeColIndex > WORD_LEN - 1) activeColIndex = WORD_LEN - 1;

    updateRowText(activeRowIndex, currentTypedArr);
    updateActiveRowUI();

    // AUTO-SUBMIT: если все заполнено — отправляем догадку автоматически
    if (currentTypedArr.every(ch => ch && ch.length > 0)) {
      await submitCurrentGuess();
    }
    e.preventDefault();
    return;
  }
});

// submit current typed row to host (guess-submitted)
async function submitCurrentGuess() {
  if (!roomCode || !nickname) return;
  if (pendingSubmit) return;
  const guessStr = currentTypedArr.join("").toLowerCase();
  if (guessStr.length !== WORD_LEN) {
    showMessage("Нужно ввести 5 букв.");
    return;
  }
  pendingSubmit = true;
  typingActive = false;
  updateActiveRowUI();
  await sendEvent("guess-submitted", { name: nickname, guess: guessStr });
  // После отправки мы ждём событие guess-result от хоста, который обновит строку
}

// Host: listen for guess-submitted and evaluate
function hostBindForEvaluations() {
  if (!isHost || !channel) return;
  // make sure not to double-bind
  channel.unbind("guess-submitted");
  channel.bind("guess-submitted", async (data) => {
    // data: {name, guess}
    if (!secretWord) {
      // host hasn't set a word yet
      await sendEvent("message", { text: "Хост не задал слово." });
      return;
    }
    // evaluate
    const result = evaluateGuess(secretWord, data.guess);
    const rowIndex = guesses.length;
    // broadcast guess-result so all clients can render the colored row
    await sendEvent("guess-result", { name: data.name, guess: data.guess, result, rowIndex });
    // host stores it locally
    guesses.push({ name: data.name, guess: data.guess, result });

    if (result.every(x => x === "green")) {
      await sendEvent("winner", { name: data.name, word: secretWord });
      secretWord = null; // clear secret after round
      hostControls.classList.remove("hidden");
    }
  });
}

// Before unload — attempt to notify
window.addEventListener("beforeunload", () => {
  if (roomCode && nickname) {
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
  const params = new URLSearchParams(location.search);
  const code = params.get("room");
  if (code) joinCodeInput.value = code.toUpperCase();
})();

// store nickname when typed
nicknameInput.addEventListener("change", () => {
  localStorage.setItem("wordle_nick", nicknameInput.value.trim());
});
