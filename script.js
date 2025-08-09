// script.js — Multiplayer Wordle frontend for GitHub Pages + Pusher + Vercel Function
// ------------------------------------------------------------------------------
// Перед использованием: замените значения в блоке CONFIG (ниже) на свои данные:
//  - PUSHER_KEY  : ключ из Pusher (App Keys)
//  - PUSHER_CLUSTER : кластер, например "eu"
//  - SERVER_ENDPOINT : URL вашего serverless-эндпойнта (Vercel) вида https://your-app.vercel.app/api/send
// ------------------------------------------------------------------------------

// ===================== CONFIG — ЗАМЕНИТЕ ЭТИ ЗНАЧЕНИЯ =====================
const PUSHER_KEY = "570abd9dffaf960c32a8";
const PUSHER_CLUSTER = "eu"; // например "eu"
const SERVER_ENDPOINT = "https://wordle-server-ten.vercel.app/api/send";
// ========================================================================

// Библиотека Pusher подключена в index.html: <script src="https://js.pusher.com/8.2/pusher.min.js"></script>
Pusher.logToConsole = false;
const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });

// ========== Элементы DOM ==========
const loginScreen = document.getElementById("login-screen");
const nicknameInput = document.getElementById("nickname");
const createBtn = document.getElementById("create-room");
const joinCodeInput = document.getElementById("join-code");
const joinBtn = document.getElementById("join-room");

const gameScreen = document.getElementById("game-screen");
const roomInfo = document.getElementById("room-info");
const hostControls = document.getElementById("host-controls");
const secretWordInput = document.getElementById("secret-word");
const startBtn = document.getElementById("start-game");
const guessSection = document.getElementById("guess-section");
const guessInput = document.getElementById("guess");
const sendGuessBtn = document.getElementById("send-guess");
const messagesDiv = document.getElementById("messages");

// Доп. элементы (если нужно позже — можно добавить)
let playersListDiv = null;

// ========== Состояние ==========
let nickname = "";
let roomCode = "";
let channel = null;
let isHost = false;
let secretWord = null;
let players = []; // массив ников
const MAX_PLAYERS = 10;

// ========== Утилиты ==========
function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

function showMessage(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    messagesDiv.appendChild(el);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function setRoomHeader() {
    roomInfo.textContent = `Комната: ${roomCode} — Игроков: ${players.length}/${MAX_PLAYERS}` + (isHost ? " (Вы — хост)" : "");
}

// Асинхронно шлём событие на Vercel (serverless) который триггерит Pusher
async function sendEvent(event, data) {
    if (!SERVER_ENDPOINT || SERVER_ENDPOINT.includes("REPLACE_WITH")) {
        alert("Ошибка: SERVER_ENDPOINT не настроен в script.js");
        return;
    }
    try {
        const res = await fetch(SERVER_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                channel: `room-${roomCode}`,
                event,
                data
            })
        });
        if (!res.ok) {
            const text = await res.text();
            console.error("sendEvent error:", res.status, text);
        }
    } catch (e) {
        console.error("sendEvent fetch failed", e);
    }
}

// Подписка и бинды Pusher
function subscribeToRoom(code) {
    roomCode = code.toUpperCase();
    channel = pusher.subscribe(`room-${roomCode}`);

    channel.bind("player-joined", (data) => {
        // Ожидаем, что в data.players передаётся актуальный список с сервера/клиентов.
        players = Array.isArray(data.players) ? data.players.slice(0, MAX_PLAYERS) : players;
        showMessage(`<b>${escapeHtml(data.name)}</b> присоединился(ась).`);
        setRoomHeader();
    });

    channel.bind("player-left", (data) => {
        players = Array.isArray(data.players) ? data.players.slice(0, MAX_PLAYERS) : players;
        showMessage(`<i>${escapeHtml(data.name)} покинул(а) комнату</i>`);
        setRoomHeader();
    });

    channel.bind("game-started", (data) => {
        secretWord = data.word?.toLowerCase() || null;
        showMessage(`<b>Хост начал игру.</b> Начинайте угадывать!`);
        if (!isHost) {
            guessSection.classList.remove("hidden");
        } else {
            hostControls.classList.add("hidden");
        }
    });

    channel.bind("player-guessed", (data) => {
        showMessage(`${escapeHtml(data.name)}: ${escapeHtml(data.guess)}`);
    });

    channel.bind("winner", (data) => {
        showMessage(`🎉 Победитель: <b>${escapeHtml(data.name)}</b> — слово: <b>${escapeHtml(data.word)}</b>`);
        // Завершили раунд — хост может задать новое слово
        if (isHost) {
            hostControls.classList.remove("hidden");
        } else {
            guessSection.classList.add("hidden");
        }
        // Сброс секретного слова на клиенте (в реальности word все ещё на хосте)
        secretWord = null;
    });

    channel.bind("host-changed", (data) => {
        // Если хост сменился — уведомляем
        showMessage(`<i>Новый хост: ${escapeHtml(data.name)}</i>`);
    });

    // Отображаем UI
    loginScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    setRoomHeader();
    showMessage(`<i>Вы в комнате ${roomCode}. Ожидаем игроков...</i>`);
}

// Простая HTML-экранизация
function escapeHtml(s) {
    if (!s) return "";
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ========== Обработчики UI ==========
createBtn.onclick = async () => {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert("Введите ник.");
    isHost = true;
    const code = generateRoomCode();
    subscribeToRoom(code);

    players = [nickname];
    setRoomHeader();

    // Сообщаем о присоединении (здесь клиент сообщает остальным через сервер)
    await sendEvent("player-joined", { name: nickname, players });

    // Показываем контролы хоста
    hostControls.classList.remove("hidden");
    guessSection.classList.add("hidden");
};

joinBtn.onclick = async () => {
    nickname = nicknameInput.value.trim();
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!nickname || !code) return alert("Введите ник и код комнаты.");
    // Подписываемся на канал
    subscribeToRoom(code);

    // Просим других обновить список (каждый клиент обновляет players по своему усмотрению)
    // Мы отправляем player-joined и передаём свой ник;
    players.push(nickname);
    if (players.length > MAX_PLAYERS) {
        alert("Комната заполнена (макс 10).");
        // подписку можно отменить:
        pusher.unsubscribe(`room-${roomCode}`);
        loginScreen.classList.remove("hidden");
        gameScreen.classList.add("hidden");
        return;
    }
    await sendEvent("player-joined", { name: nickname, players });
};

// Хост начинает игру, задавая слово
startBtn.onclick = async () => {
    if (!isHost) return;
    const word = secretWordInput.value.trim().toLowerCase();
    if (!word) return alert("Введите слово для игры.");
    // Хост хранит слово локально и рассылает событие начала (в событии можно не передавать слово,
    // но нам удобно передать его, чтобы простая реализация работала — это означает, что слово видимо всем технично,
    // но в реальной игре слово НЕ нужно расшаривать — здесь доверяем хосту)
    secretWord = word;
    hostControls.classList.add("hidden");
    await sendEvent("game-started", { word: secretWord });
    showMessage(`<i>Игра запущена хостом. Слово задано.</i>`);
};

// Отправка предположения
sendGuessBtn.onclick = async () => {
    const guess = guessInput.value.trim().toLowerCase();
    if (!guess) return;
    if (!roomCode) return alert("Вы не в комнате.");
    // Отправляем событие о попытке
    await sendEvent("player-guessed", { name: nickname, guess });

    // Если угадал — вещаем победу
    // Здесь сравниваем с локальным secretWord; но т.к. настоящую копию слова хранит хост,
    // сравнение корректно только если secretWord задан на этом клиенте (например если хост)
    // Но хост тоже будет отправлять событие игроку-победителю, поэтому безопасно:
    if (guess === secretWord) {
        await sendEvent("winner", { name: nickname, word: secretWord });
    }

    guessInput.value = "";
};

// Обработка закрытия вкладки — сообщаем другим, что покинул
window.addEventListener("beforeunload", async (e) => {
    if (!roomCode || !nickname) return;
    // Обновляем локальный players с удалением нашего ника
    players = players.filter(n => n !== nickname);
    // sendEvent может не успеть уйти — это best-effort
    navigator.sendBeacon && navigator.sendBeacon(SERVER_ENDPOINT, JSON.stringify({
        channel: `room-${roomCode}`,
        event: "player-left",
        data: { name: nickname, players }
    }));
});

// Небольшая помощь по отображению списка игроков (опционально)
function renderPlayersList() {
    if (!playersListDiv) {
        playersListDiv = document.createElement("div");
        messagesDiv.parentNode.insertBefore(playersListDiv, messagesDiv);
    }
    playersListDiv.innerHTML = `<strong>Игроки:</strong> ${players.map(p => escapeHtml(p)).join(", ")}`;
}

// Подписываемся на обновления players каждую секунду (локальная попытка синхронизации UI)
setInterval(() => {
    setRoomHeader();
    renderPlayersList();
}, 1000);

// ========== Примеры сообщений из UI ==========
showMessage("<i>Добро пожаловать. Введите ник и создайте или присоединитесь к комнате.</i>");

