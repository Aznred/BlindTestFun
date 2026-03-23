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
const ROUND_DURATION = 30000; // 30 secondes

// Configuration des serveurs STUN publics de Google
const peerConfig = {
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
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
    roundActive: false,
    hostTimeout: null, // Le chrono géré par l'hôte
    // Suivi des découvertes pour la manche en cours
    titleFound: false,
    artistFound: false
};

document.getElementById('btn-create').addEventListener('click', () => {
    isHost = true;
    
    const btnCreate = document.getElementById('btn-create');
    btnCreate.innerText = "Création de la room...";
    btnCreate.disabled = true;

    if (peer) peer.destroy();

    const shortRoomId = generateShortId(6);
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

        if (conn.open) setupClient();
        else conn.on('open', setupClient);

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
    
    // Réinitialisation de la manche
    gameState.roundActive = true;
    gameState.titleFound = false;
    gameState.artistFound = false;
    
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

    // Le VRAI chronomètre géré par l'hôte
    clearTimeout(gameState.hostTimeout);
    gameState.hostTimeout = setTimeout(() => {
        endRoundTimeout();
    }, ROUND_DURATION);
}

// Fonction appelée quand le temps est écoulé sans que tout soit trouvé
function endRoundTimeout() {
    gameState.roundActive = false;
    audio.pause();
    
    const track = gameState.playlist[gameState.currentRound];
    
    broadcastState({ 
        type: 'ROUND_TIMEOUT', 
        track: `${track.trackName} - ${track.artistName}`
    });

    // On passe à la manche suivante après 5 secondes pour lire la réponse
    setTimeout(() => {
        gameState.currentRound++;
        startNextRound();
    }, 5000);
}

function checkAnswer(peerId, answer) {
    const track = gameState.playlist[gameState.currentRound];
    const normInput = answer.toLowerCase().trim();
    const normTitle = track.trackName.toLowerCase().trim();
    const normArtist = track.artistName.toLowerCase().trim();

    if (normInput.length < 3) return;

    let pointsEarned = 0;
    let messageToBroadcast = "";
    const playerName = gameState.players[peerId].name;

    // Vérification du TITRE
    if (!gameState.titleFound && normTitle.includes(normInput)) {
        gameState.titleFound = true;
        gameState.players[peerId].score += 1;
        pointsEarned += 1;
        messageToBroadcast += `🎵 ${playerName} a trouvé le Titre ! `;
    }

    // Vérification de l'ARTISTE
    if (!gameState.artistFound && normArtist.includes(normInput)) {
        gameState.artistFound = true;
        gameState.players[peerId].score += 1;
        pointsEarned += 1;
        messageToBroadcast += `🎤 ${playerName} a trouvé l'Artiste ! `;
    }

    // Si des points ont été marqués
    if (pointsEarned > 0) {
        
        // Si TOUT a été trouvé (Titre ET Artiste), la manche s'arrête
        if (gameState.titleFound && gameState.artistFound) {
            gameState.roundActive = false;
            clearTimeout(gameState.hostTimeout); // On coupe le chrono de l'hôte
            audio.pause();
            
            broadcastState({ 
                type: 'ROUND_WON_COMPLETELY', 
                message: messageToBroadcast,
                track: `${track.trackName} - ${track.artistName}`,
                players: gameState.players
            });

            setTimeout(() => {
                gameState.currentRound++;
                startNextRound();
            }, 5000);
        } 
        // Si SEULEMENT l'un des deux a été trouvé, la manche continue
        else {
            broadcastState({ 
                type: 'PARTIAL_WIN', 
                message: messageToBroadcast,
                players: gameState.players
            });
        }
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
    btnJoin.innerText = "Connexion...";
    btnJoin.disabled = true;

    if (peer) peer.destroy();
    
    peer = new Peer(peerConfig);

    peer.on('open', (id) => {
        myPeerId = id;
        hostConnection = peer.connect(inputId, { reliable: true });

        let timeout = setTimeout(() => {
            alert("Hôte introuvable ou erreur réseau.");
            btnJoin.innerText = "Rejoindre";
            btnJoin.disabled = false;
        }, 8000);

        hostConnection.on('open', () => {
            clearTimeout(timeout);
            btnJoin.innerText = "Rejoindre";
            btnJoin.disabled = false;
            showView('lobby');
        });

        hostConnection.on('data', (data) => {
            if (data.type === 'LOBBY_UPDATE') {
                const list = document.getElementById('players-list');
                list.innerHTML = '';
                Object.values(data.players).forEach(p => list.innerHTML += `<li>${p.name} - Score: ${p.score}</li>`);
            }
            
            if (data.type === 'START_ROUND') {
                showView('game');
                document.getElementById('round-info').innerText = `Manche ${data.round}/${data.maxRounds}`;
                feedbackMessage.innerText = "Titre (1pt) / Artiste (1pt)";
                feedbackMessage.style.color = "white";
                inputAnswer.value = '';
                inputAnswer.disabled = false;
                resetTimer();
                startTimer(ROUND_DURATION);
            }

            if (data.type === 'PARTIAL_WIN') {
                // Quelqu'un a trouvé soit le titre soit l'artiste, mais on continue !
                feedbackMessage.innerText = data.message + "\nContinuez de chercher le reste !";
                feedbackMessage.style.color = "#f39c12"; // Orange/Jaune
                
                // Met à jour les scores affichés si besoin
                // (Optionnel, on le garde en mémoire pour la fin de partie)
            }

            if (data.type === 'ROUND_WON_COMPLETELY') {
                // Titre et Artiste trouvés !
                feedbackMessage.innerText = `${data.message}\n\n✅ RÉPONSE : ${data.track}`;
                feedbackMessage.style.color = "#1db954"; // Vert
                inputAnswer.disabled = true;
                resetTimer(); // Arrête visuellement le chrono
            }

            if (data.type === 'ROUND_TIMEOUT') {
                // Temps écoulé
                feedbackMessage.innerText = `⏱️ Temps écoulé !\n\n❌ RÉPONSE : ${data.track}`;
                feedbackMessage.style.color = "#e74c3c"; // Rouge
                inputAnswer.disabled = true;
                resetTimer();
            }

            if (data.type === 'END_GAME') {
                showLeaderboard(data.players);
                resetTimer();
            }
        });
    });

    peer.on('error', (err) => {
        alert('Erreur de connexion. Vérifiez le code.');
        btnJoin.innerText = "Rejoindre";
        btnJoin.disabled = false;
    });
});

document.getElementById('btn-submit-answer').addEventListener('click', () => {
    const answer = inputAnswer.value;
    if (hostConnection && hostConnection.open && answer) {
        hostConnection.send({ type: 'SUBMIT_ANSWER', answer: answer });
        inputAnswer.value = '';
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
