// ==========================================
// 🛠️ VARIABLES GLOBALES ET INITIALISATION
// ==========================================

let peer = null;
let myPeerId = null;
let isHost = false;

let hostConnection = null;
let clientConnections = [];

const views = {
    home: document.getElementById('view-home'),
    lobby: document.getElementById('view-lobby'),
    game: document.getElementById('view-game'),
    leaderboard: document.getElementById('view-leaderboard')
};
const audio = document.getElementById('audio-player');
const inputAnswer = document.getElementById('input-answer');
const feedbackMessage = document.getElementById('feedback-message');
const timerBar = document.getElementById('timer-bar');

const MAX_ROUNDS = 5;
const ROUND_DURATION = 30000; 

// 🔥 LE FIX EST ICI : Configuration des serveurs STUN publics de Google
const peerConfig = {
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    }
};

function generateShortId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < length; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

// ==========================================
// 👑 LOGIQUE DE L'HÔTE
// ==========================================

let gameState = {
    players: {}, 
    playlist: [],
    currentRound: 0,
    roundActive: false
};

document.getElementById('btn-create').addEventListener('click', () => {
    isHost = true;
    
    const btnCreate = document.getElementById('btn-create');
    btnCreate.innerText = "Création de la room...";
    btnCreate.disabled = true;

    if (peer) peer.destroy();

    const shortRoomId = generateShortId(6);
    // On passe la configuration STUN ici
    peer = new Peer(shortRoomId, peerConfig);

    peer.on('open', (id) => {
        myPeerId = id;
        gameState.players[myPeerId] = { name: "Hôte", score: 0 };
        document.getElementById('display-room-id').innerText = myPeerId;
        document.getElementById('btn-start-game').style.display = 'block';
        
        btnCreate.innerText = "Créer une room (Hôte)";
        btnCreate.disabled = false;
        showView('lobby');
        updateLobbyUI();
    });

    peer.on('error', (err) => {
        alert('Erreur: ' + err.type);
        btnCreate.innerText = "Créer une room (Hôte)";
        btnCreate.disabled = false;
    });

    peer.on('connection', (conn) => {
        if (!isHost) return;
        
        const setupClient = () => {
            if (!clientConnections.includes(conn)) {
                clientConnections.push(conn);
                gameState.players[conn.peer] = { name: "Joueur " + clientConnections.length, score: 0 };
                broadcastState({ type: 'LOBBY_UPDATE', players: gameState.players });
                updateLobbyUI();
            }
        };

        if (conn.open) {
            setupClient();
        } else {
            conn.on('open', setupClient);
        }

        conn.on('data', (data) => {
            if (data.type === 'SUBMIT_ANSWER' && gameState.roundActive) {
                checkAnswer(conn.peer, data.answer);
            }
        });
    });
});

function broadcastState(data) {
    clientConnections.forEach(conn => {
        if (conn.open) conn.send(data);
    });
}

function updateLobbyUI() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    Object.values(gameState.players).forEach(p => {
        list.innerHTML += `<li>${p.name} - Score: ${p.score}</li>`;
    });
}

document.getElementById('btn-start-game').addEventListener('click', async () => {
    try {
        const res = await fetch('https://itunes.apple.com/search?term=pop+hits&media=music&limit=15');
        const data = await res.json();
        gameState.playlist = data.results.filter(track => track.previewUrl);
        
        if (gameState.playlist.length < MAX_ROUNDS) return alert('Pas assez de musiques trouvées.');

        gameState.currentRound = 0;
        startNextRound();
    } catch (err) {
        alert('Erreur réseau. Impossible de charger les musiques.');
    }
});

function startNextRound() {
    if (gameState.currentRound >= MAX_ROUNDS || gameState.currentRound >= gameState.playlist.length) {
        return endGame();
    }
    
    gameState.roundActive = true;
    const track = gameState.playlist[gameState.currentRound];
    
    audio.src = track.previewUrl;
    audio.play();

    broadcastState({ 
        type: 'START_ROUND', 
        round: gameState.currentRound + 1,
        maxRounds: MAX_ROUNDS
    });

    showView('game');
    document.getElementById('round-info').innerText = `Manche ${gameState.currentRound + 1}/${MAX_ROUNDS}`;
}

function checkAnswer(peerId, answer) {
    const track = gameState.playlist[gameState.currentRound];
    
    const normInput = answer.toLowerCase().trim();
    const normTitle = track.trackName.toLowerCase().trim();
    const normArtist = track.artistName.toLowerCase().trim();

    if (normTitle.includes(normInput) || normArtist.includes(normInput)) {
        if (normInput.length < 3) return;

        gameState.roundActive = false;
        gameState.players[peerId].score += 10;
        audio.pause();
        
        broadcastState({ 
            type: 'ROUND_WON', 
            winner: gameState.players[peerId].name, 
            track: `${track.trackName} - ${track.artistName}`,
            players: gameState.players
        });

        setTimeout(() => {
            gameState.currentRound++;
            startNextRound();
        }, 4000);
    }
}

function endGame() {
    broadcastState({ type: 'END_GAME', players: gameState.players });
    showLeaderboard(gameState.players);
}


// ==========================================
// 📱 LOGIQUE DU CLIENT
// ==========================================

document.getElementById('btn-join').addEventListener('click', () => {
    isHost = false;
    const inputId = document.getElementById('input-join-id').value.toUpperCase().trim();
    if (!inputId) return alert('Entrez le code de la room !');

    const btnJoin = document.getElementById('btn-join');
    btnJoin.innerText = "Connexion en cours...";
    btnJoin.disabled = true;

    if (peer) peer.destroy();
    
    // On passe la configuration STUN ici aussi
    peer = new Peer(peerConfig);

    peer.on('open', (id) => {
        myPeerId = id;
        hostConnection = peer.connect(inputId, { reliable: true });

        let timeout = setTimeout(() => {
            alert("Code incorrect, hôte introuvable, ou pare-feu trop strict.");
            btnJoin.innerText = "Rejoindre une room (Client)";
            btnJoin.disabled = false;
        }, 8000); // J'ai monté un peu le temps à 8 secondes car la recherche d'IP prend du temps

        hostConnection.on('open', () => {
            clearTimeout(timeout);
            btnJoin.innerText = "Rejoindre une room (Client)";
            btnJoin.disabled = false;
            showView('lobby');
        });

        hostConnection.on('data', (data) => {
            if (data.type === 'LOBBY_UPDATE') {
                const list = document.getElementById('players-list');
                list.innerHTML = '';
                Object.values(data.players).forEach(p => list.innerHTML += `<li>${p.name}</li>`);
            }
            
            if (data.type === 'START_ROUND') {
                showView('game');
                document.getElementById('round-info').innerText = `Manche ${data.round}/${data.maxRounds}`;
                feedbackMessage.innerText = "À vous de jouer !";
                feedbackMessage.style.color = "white";
                inputAnswer.value = '';
                resetTimer();
                startTimer(ROUND_DURATION);
            }

            if (data.type === 'ROUND_WON') {
                feedbackMessage.innerText = `🏆 Gagné par ${data.winner} ! \nC'était : ${data.track}`;
                feedbackMessage.style.color = "#1db954";
                resetTimer();
            }

            if (data.type === 'END_GAME') {
                showLeaderboard(data.players);
                resetTimer();
            }
        });
    });

    peer.on('error', (err) => {
        alert('Erreur de connexion. Vérifiez le code ou votre réseau.');
        btnJoin.innerText = "Rejoindre une room (Client)";
        btnJoin.disabled = false;
    });
});

document.getElementById('btn-submit-answer').addEventListener('click', () => {
    const answer = inputAnswer.value;
    if (hostConnection && hostConnection.open && answer) {
        hostConnection.send({ type: 'SUBMIT_ANSWER', answer: answer });
        inputAnswer.value = '';
        feedbackMessage.innerText = "Envoyé !";
    }
});

// ==========================================
// ⏱️ CHRONOMÈTRE ET CLASSEMENT
// ==========================================

let timerInterval = null;

function resetTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerBar.style.width = '100%';
}

function startTimer(duration) {
    const startTime = Date.now();
    timerInterval = setInterval(() => {
        const remaining = duration - (Date.now() - startTime);
        
        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerBar.style.width = '0%';
            feedbackMessage.innerText = "Temps écoulé !";
            feedbackMessage.style.color = "orange";
        } else {
            timerBar.style.width = (remaining / duration) * 100 + '%';
        }
    }, 100);
}

function showLeaderboard(playersData) {
    showView('leaderboard');
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    
    const sortedPlayers = Object.values(playersData).sort((a, b) => b.score - a.score);
    sortedPlayers.forEach((p, index) => {
        list.innerHTML += `<li><strong>#${index + 1} ${p.name}</strong> : ${p.score} pts</li>`;
    });
}
