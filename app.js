// --- VARIABLES GLOBALES ET DOM ---
const peer = new Peer(); // Initialisation de WebRTC
let myPeerId = null;
let isHost = false;
let hostConnection = null; // Pour les clients
let clientConnections = []; // Pour l'hôte

// Elements DOM
const views = {
    home: document.getElementById('view-home'),
    lobby: document.getElementById('view-lobby'),
    game: document.getElementById('view-game'),
    leaderboard: document.getElementById('view-leaderboard')
};

// --- UTILITAIRES (Orthographe) ---
// Enlève les accents, met en minuscule
function normalizeStr(str) {
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Calcule la distance de Levenshtein entre deux mots
function getLevenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}

// Vérifie si la réponse est proche de la cible (tolérance de 2 erreurs)
function isAnswerCorrect(input, target) {
    const normInput = normalizeStr(input);
    const normTarget = normalizeStr(target);
    // Vérification exacte, inclusion, ou distance faible
    if (normTarget.includes(normInput) && normInput.length > 3) return true; 
    return getLevenshteinDistance(normInput, normTarget) <= 2;
}

// --- GESTION DES VUES ---
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

// --- INITIALISATION PEERJS ---
peer.on('open', (id) => {
    myPeerId = id;
    console.log('Mon Peer ID :', myPeerId);
});


// ==========================================
// 👑 LOGIQUE DE L'HÔTE (Le "Serveur")
// ==========================================
let gameState = {
    players: {}, // { peerId: { name: "Joueur 1", score: 0 } }
    playlist: [],
    currentRound: 0,
    roundActive: false
};

document.getElementById('btn-create').addEventListener('click', () => {
    isHost = true;
    gameState.players[myPeerId] = { name: "Hôte", score: 0 };
    document.getElementById('display-room-id').innerText = myPeerId;
    document.getElementById('btn-start-game').style.display = 'block';
    showView('lobby');
    updateLobbyUI();
});

// Quand un client se connecte à l'hôte
peer.on('connection', (conn) => {
    if (!isHost) return;
    
    clientConnections.push(conn);
    gameState.players[conn.peer] = { name: "Joueur " + (clientConnections.length + 1), score: 0 };
    
    conn.on('open', () => {
        // Envoie l'état initial au client
        broadcastState({ type: 'LOBBY_UPDATE', players: gameState.players });
        updateLobbyUI();
    });

    // Quand l'hôte reçoit des données (ex: une réponse) d'un client
    conn.on('data', (data) => {
        if (data.type === 'SUBMIT_ANSWER' && gameState.roundActive) {
            checkAnswer(conn.peer, data.answer);
        }
    });
});

// Envoie un message à tous les clients
function broadcastState(data) {
    clientConnections.forEach(conn => conn.send(data));
}

function updateLobbyUI() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    Object.values(gameState.players).forEach(p => {
        list.innerHTML += `<li>${p.name} - Score: ${p.score}</li>`;
    });
}

// Lancement du jeu par l'hôte
document.getElementById('btn-start-game').addEventListener('click', async () => {
    // 1. Récupérer des musiques via l'API iTunes
    const res = await fetch('https://itunes.apple.com/search?term=hits&media=music&limit=10');
    const data = await res.json();
    gameState.playlist = data.results.filter(track => track.previewUrl); // Garde seulement celles avec audio
    
    gameState.currentRound = 0;
    startNextRound();
});

function startNextRound() {
    if (gameState.currentRound >= 5 || gameState.currentRound >= gameState.playlist.length) {
        return endGame();
    }
    
    gameState.roundActive = true;
    const track = gameState.playlist[gameState.currentRound];
    
    // Joue l'audio chez l'hôte (les clients devront peut-être l'écouter via le téléphone de l'hôte, 
    // ou on peut envoyer l'URL pour qu'ils jouent l'audio en sync. Faisons simple : l'hôte joue la musique)
    const audio = document.getElementById('audio-player');
    audio.src = track.previewUrl;
    audio.play();

    // Avertit les clients du début de la manche
    broadcastState({ 
        type: 'START_ROUND', 
        round: gameState.currentRound + 1,
        // Optionnel: previewUrl: track.previewUrl si tu veux que la musique sorte du tel des clients
    });

    showView('game');
    document.getElementById('round-info').innerText = `Manche ${gameState.currentRound + 1}/5`;
}

// Validation de la réponse par l'hôte
function checkAnswer(peerId, answer) {
    const track = gameState.playlist[gameState.currentRound];
    const targetTitle = track.trackName;
    const targetArtist = track.artistName;

    if (isAnswerCorrect(answer, targetTitle) || isAnswerCorrect(answer, targetArtist)) {
        gameState.roundActive = false;
        gameState.players[peerId].score += 10; // +10 points pour le plus rapide
        
        document.getElementById('audio-player').pause();
        
        broadcastState({ 
            type: 'ROUND_WON', 
            winner: gameState.players[peerId].name, 
            track: `${targetTitle} - ${targetArtist}`,
            players: gameState.players
        });

        // Manche suivante après 4 secondes
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
    const hostId = document.getElementById('input-join-id').value;
    if (!hostId) return alert('Entrez un ID !');

    // Connexion à l'hôte
    hostConnection = peer.connect(hostId);

    hostConnection.on('open', () => {
        showView('lobby');
    });

    // Écoute les ordres de l'hôte
    hostConnection.on('data', (data) => {
        if (data.type === 'LOBBY_UPDATE') {
            const list = document.getElementById('players-list');
            list.innerHTML = '';
            Object.values(data.players).forEach(p => list.innerHTML += `<li>${p.name}</li>`);
        }
        
        if (data.type === 'START_ROUND') {
            showView('game');
            document.getElementById('round-info').innerText = `Manche ${data.round}/5`;
            document.getElementById('feedback-message').innerText = "À vous de jouer !";
            document.getElementById('input-answer').value = '';
        }

        if (data.type === 'ROUND_WON') {
            document.getElementById('feedback-message').innerText = 
                `Gagné par ${data.winner} ! C'était : ${data.track}`;
        }

        if (data.type === 'END_GAME') {
            showLeaderboard(data.players);
        }
    });
});

// Le client envoie sa réponse
document.getElementById('btn-submit-answer').addEventListener('click', () => {
    const answer = document.getElementById('input-answer').value;
    if (hostConnection && hostConnection.open) {
        hostConnection.send({ type: 'SUBMIT_ANSWER', answer: answer });
        document.getElementById('input-answer').value = ''; // On vide le champ
    }
});


// ==========================================
// 🏆 FONCTION COMMUNE (LEADERBOARD)
// ==========================================
function showLeaderboard(playersData) {
    showView('leaderboard');
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    
    // Tri des joueurs par score décroissant
    const sortedPlayers = Object.values(playersData).sort((a, b) => b.score - a.score);
    
    sortedPlayers.forEach(p => {
        list.innerHTML += `<li><strong>${p.name}</strong> : ${p.score} pts</li>`;
    });
    }
