// script.js
const playerName = localStorage.getItem("playerName") || prompt("Введите ваш ник:");
localStorage.setItem("playerName", playerName);

const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get("room") || null;
let isHost = false;

let players = [];
let wordToGuess = "";
let currentGuess = "";
let guesses = [];

// Подключаемся к Pusher
const pusher = new Pusher("570abd9dffaf960c32a8", { cluster: "eu" });
let channel;

function renderPlayers() {
    const list = document.getElementById("playerList");
    const count = document.getElementById("playerCount");
    list.innerHTML = players.map(p => `<li>${p}</li>`).join("");
    count.textContent = `Игроки: ${players.length}/10`;
}

function createBoard() {
    const board = document.getElementById("board");
    board.innerHTML = "";
    for (let i = 0; i < 6; i++) {
        const row = document.createElement("div");
        row.className = "row";
        for (let j = 0; j < 5; j++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            row.appendChild(cell);
        }
        board.appendChild(row);
    }
}

function colorizeGuess(rowIndex, guess) {
    const row = document.getElementsByClassName("row")[rowIndex];
    const cells = row.getElementsByClassName("cell");

    for (let i = 0; i < 5; i++) {
        cells[i].textContent = guess[i].toUpperCase();
        if (guess[i] === wordToGuess[i]) {
            cells[i].classList.add("green");
        } else if (wordToGuess.includes(guess[i])) {
            cells[i].classList.add("yellow");
        } else {
            cells[i].classList.add("gray");
        }
    }
}

function sendEvent(event, data) {
    fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: `room-${roomCode}`, event, data })
    });
}

// Создание комнаты
document.getElementById("createRoom")?.addEventListener("click", () => {
    roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    isHost = true;
    wordToGuess = prompt("Введите загаданное слово (5 букв):").toLowerCase();
    window.location.href = `?room=${roomCode}`;
});

// Подключение к комнате
document.getElementById("joinRoom")?.addEventListener("click", () => {
    const code = prompt("Введите код комнаты:").toUpperCase();
    roomCode = code;
    window.location.href = `?room=${roomCode}`;
});

if (roomCode) {
    channel = pusher.subscribe(`room-${roomCode}`);

    channel.bind("player-join", data => {
        if (!players.includes(data.name)) {
            players.push(data.name);
            renderPlayers();
        }
    });

    channel.bind("word-set", data => {
        wordToGuess = data.word;
        createBoard();
        guesses = [];
    });

    channel.bind("player-guess", data => {
        guesses.push(data.guess);
        colorizeGuess(guesses.length - 1, data.guess);
        if (data.guess === wordToGuess) {
            alert(`Победил: ${data.name}! Загаданное слово: ${wordToGuess}`);
            if (isHost) {
                const newWord = prompt("Введите новое слово (5 букв):").toLowerCase();
                sendEvent("word-set", { word: newWord });
            }
        }
    });

    // Регистрируем себя в комнате
    sendEvent("player-join", { name: playerName });
}

// Ввод букв и отправка
document.addEventListener("keydown", e => {
    if (!wordToGuess) return;
    if (e.key === "Backspace" && currentGuess.length > 0) {
        currentGuess = currentGuess.slice(0, -1);
    } else if (/^[a-zA-Zа-яА-Я]$/.test(e.key) && currentGuess.length < 5) {
        currentGuess += e.key.toLowerCase();
    } else if (e.key === "Enter" && currentGuess.length === 5) {
        sendEvent("player-guess", { name: playerName, guess: currentGuess });
        currentGuess = "";
    }

    const row = document.getElementsByClassName("row")[guesses.length];
    const cells = row.getElementsByClassName("cell");
    for (let i = 0; i < 5; i++) {
        cells[i].textContent = currentGuess[i]?.toUpperCase() || "";
    }
});
