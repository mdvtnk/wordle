// ==== Pusher Config ====
const PUSHER_KEY = "570abd9dffaf960c32a8";
const PUSHER_CLUSTER = "eu"; // смотри в настройках Pusher

Pusher.logToConsole = false;
const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });

// ==== Переменные ====
let nickname = "";
let roomCode = "";
let channel = null;
let isHost = false;
let secretWord = "";
let players = [];

// ==== Элементы ====
const loginScreen = document.getElementById("login-screen");
const gameScreen = document.getElementById("game-screen");
const roomInfo = document.getElementById("room-info");
const hostControls = document.getElementById("host-controls");
const guessSection = document.getElementById("guess-section");
const messagesDiv = document.getElementById("messages");

// ==== Функции ====
function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

function showMessage(msg) {
    messagesDiv.innerHTML += `<div>${msg}</div>`;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function joinRoom(code) {
    roomCode = code;
    channel = pusher.subscribe(`room-${roomCode}`);

    channel.bind("player-joined", data => {
        players = data.players;
        showMessage(`Игрок ${data.name} присоединился.`);
    });

    channel.bind("game-started", data => {
        secretWord = data.word;
        if (!isHost) {
            guessSection.classList.remove("hidden");
        }
        showMessage("Игра началась! Пора угадывать.");
    });

    channel.bind("player-guessed", data => {
        showMessage(`${data.name} попытался: ${data.guess}`);
    });

    channel.bind("winner", data => {
        showMessage(`🎉 Победитель: ${data.name}! Слово: ${data.word}`);
        guessSection.classList.add("hidden");
        if (isHost) hostControls.classList.remove("hidden");
    });

    loginScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    roomInfo.textContent = `Комната: ${roomCode}`;
}

async function sendEvent(event, data) {
    await fetch(`https://wordle-server-ten.vercel.app/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: `room-${roomCode}`, event, data })
    });
}

// ==== Обработчики ====
document.getElementById("create-room").onclick = () => {
    nickname = document.getElementById("nickname").value.trim();
    if (!nickname) return alert("Введите ник!");
    isHost = true;
    const code = generateRoomCode();
    joinRoom(code);
    hostControls.classList.remove("hidden");
    players.push(nickname);
    sendEvent("player-joined", { name: nickname, players });
};

document.getElementById("join-room").onclick = () => {
    nickname = document.getElementById("nickname").value.trim();
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    if (!nickname || !code) return alert("Введите ник и код!");
    joinRoom(code);
    sendEvent("player-joined", { name: nickname, players });
};

document.getElementById("start-game").onclick = () => {
    secretWord = document.getElementById("secret-word").value.trim().toLowerCase();
    if (!secretWord) return alert("Введите слово!");
    hostControls.classList.add("hidden");
    sendEvent("game-started", { word: secretWord });
};

document.getElementById("send-guess").onclick = () => {
    const guess = document.getElementById("guess").value.trim().toLowerCase();
    if (!guess) return;
    sendEvent("player-guessed", { name: nickname, guess });
    if (guess === secretWord) {
        sendEvent("winner", { name: nickname, word: secretWord });
    }
};
