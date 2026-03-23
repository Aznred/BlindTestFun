// ==========================================
// 🛠️ VARIABLES GLOBALES ET INITIALISATION
// ==========================================

// Instance de PeerJS (WebRTC)
// Nous n'initialisons pas l'instance tout de suite, car l'Hôte a besoin d'un ID court avant.
let peer = null;
let myPeerId = null;
let isHost = false;

// Pour les clients : la connexion active avec l'hôte
let hostConnection = null;
// Pour l'hôte : la liste des connexions actives avec les clients
let clientConnections = [];

// Éléments du DOM (on les récupère une fois pour toutes)
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

// Variables de jeu (utilisées par l'hôte et le client)
const MAX_ROUNDS = 5;
const ROUND_DURATION = 30000; // 30 secondes en millisecondes

// --- FONCTION UTILITAIRE : Générer un ID court (6 caractères) ---
// Utilise des lettres majuscules et des chiffres pour une meilleure lisibilité.
function generateShortId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < length; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

// ==========================================
// 👑 LOGIQUE DE L'HÔTE (Le "Serveur")
// ==========================================

// État du jeu géré par l'hôte
let gameState = {
    players: {}, // { peerId: { name: "Joueur 1", score: 0 } }
    playlist: [],
    currentRound: 0,
    roundActive: false,
    roundStartTime: null
};

// --- ACTION : L'utilisateur veut CRÉER une room ---
document.getElementById('btn-create').addEventListener('click', () => {
    isHost = true;
    
    // 1. Générer l'ID court de la room
    const shortRoomId = generateShortId(6);
    
    // 2. Initialiser l'instance Peer avec cet ID court spécifique
    // C'est le FIX TECHNIQUE : l'hôte s'enregistre avec l'ID court.
    peer = new Peer(shortRoomId);

    // Quand l'hôte s'est bien enregistré avec l'ID court
    peer.on('open', (id) => {
        myPeerId = id;
        console.log('✅ Hôte enregistré avec l\'ID :', myPeerId);
        
        // Mettre à jour l'interface
        gameState.players[myPeerId] = { name: "Hôte", score: 0 };
        document.getElementById('display-room-id').innerText = myPeerId;
        document.getElementById('btn-start-game').style.display = 'block'; // Activer le bouton de lancement
        showView('lobby');
        updateLobbyUI();
    });

    // Écouter les erreurs PeerJS (très important pour le debug)
    peer.on('error', (err) => {
        console.error('❌ Erreur PeerJS Hôte:', err);
        alert('Erreur PeerJS, réessayez. Détails: ' + err.type);
        showView('home'); // Retour à l'accueil en cas d'erreur
    });

    // --- LOGIQUE HÔTE : Quand un client tente de se connecter ---
    peer.on('connection', (conn) => {
        if (!isHost) return;
        
        console.log('🔗 Connexion d\'un client reçue :', conn.peer);
        clientConnections.push(conn);
        gameState.players[conn.peer] = { name: "Joueur " + (clientConnections.length + 1), score: 0 };
        
        conn.on('open', () => {
            console.log('✅ Connexion client ouverte.');
            // Envoie l'état initial du lobby au nouveau client
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
});

// Envoie un message à tous les clients connectés
function broadcastState(data) {
    clientConnections.forEach(conn => {
        if (conn.open) {
            conn.send(data);
        }
    });
}

// Met à jour la liste des joueurs dans le lobby de l'hôte
function updateLobbyUI() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    Object.values(gameState.players).forEach(p => {
        list.innerHTML += `<li>${p.name} - Score: ${p.score}</li>`;
    });
}

// --- LOGIQUE HÔTE : Lancer la partie ---
document.getElementById('btn-start-game').addEventListener('click', async () => {
    // 1. Récupérer des musiques via l'API iTunes
    try {
        const res = await fetch('https://itunes.apple.com/search?term=pop+hits&media=music&limit=15');
        const data = await res.json();
        gameState.playlist = data.results.filter(track => track.previewUrl);
        
        if (gameState.playlist.length < MAX_ROUNDS) {
            alert('Pas assez de musiques trouvées, réessayez plus tard.');
            return;
        }

        console.log('🎵 Playlist prête :', gameState.playlist);
        gameState.currentRound = 0;
        startNextRound();
        
    } catch (err) {
        console.error('❌ Erreur API iTunes:', err);
        alert('Erreur de réseau lors de la récupération des musiques.');
    }
});

function startNextRound() {
    if (gameState.currentRound >= MAX_ROUNDS || gameState.currentRound >= gameState.playlist.length) {
        return endGame();
    }
    
    gameState.roundActive = true;
    gameState.roundStartTime = Date.now();
    const track = gameState.playlist[gameState.currentRound];
    
    console.log(`Manche ${gameState.currentRound + 1} démarrée. Cible : ${track.trackName} - ${track.artistName}`);
    
    // L'hôte joue la musique (haute voix)
    audio.src = track.previewUrl;
    audio.play();

    // Avertit les clients du début de la manche
    broadcastState({ 
        type: 'START_ROUND', 
        round: gameState.currentRound + 1,
        maxRounds: MAX_ROUNDS
    });

    showView('game');
    document.getElementById('round-info').innerText = `Manche ${gameState.currentRound + 1}/${MAX_ROUNDS}`;
}

// --- LOGIQUE HÔTE : Vérification de la réponse ---
function checkAnswer(peerId, answer) {
    const track = gameState.playlist[gameState.currentRound];
    const targetTitle = track.trackName;
    const targetArtist = track.artistName;

    // TODO : Activer la distance de Levenshtein ici après les tests de connexion
    // if (isAnswerCorrect(answer, targetTitle) || isAnswerCorrect(answer, targetArtist)) {
    
    // Version simple pour le test initial (exact match, insensible à la casse et espaces)
    const normInput = answer.toLowerCase().trim();
    const normTitle = targetTitle.toLowerCase().trim();
    const normArtist = targetArtist.toLowerCase().trim();

    if (normInput === normTitle || normInput === normArtist) {
        gameState.roundActive = false;
        gameState.players[peerId].score += 10; // +10 points pour le plus rapide
        
        audio.pause();
        
        // Notifier tout le monde que la manche est finie
        broadcastState({ 
            type: 'ROUND_WON', 
            winner: gameState.players[peerId].name, 
            track: `${targetTitle} - ${targetArtist}`,
            players: gameState.players
        });

        console.log('🏆 Manche gagnée par :', gameState.players[peerId].name);

        // Manche suivante après 4 secondes
        setTimeout(() => {
            gameState.currentRound++;
            startNextRound();
        }, 4000);
    }
}

function endGame() {
    console.log('🏁 Partie terminée.');
    broadcastState({ type: 'END_GAME', players: gameState.players });
    showLeaderboard(gameState.players);
}


// ==========================================
// 📱 LOGIQUE DU CLIENT
// ==========================================

// --- ACTION : L'utilisateur veut REJOINDRE une room ---
document.getElementById('btn-join').addEventListener('click', () => {
    isHost = false;
    const inputId = document.getElementById('input-join-id').value.toUpperCase().trim();
    if (!inputId) return alert('Entrez le code de la room !');

    // 1. Initialiser une instance Peer simple (le client n'a pas besoin d'ID court)
    peer = new Peer();

    peer.on('open', (id) => {
        myPeerId = id;
        console.log('✅ Client enregistré avec l\'ID :', myPeerId);
        
        // 2. Tenter la connexion à l'hôte via son ID court
        hostConnection = peer.connect(inputId);
        console.log('🔗 Tentative de connexion à l\'hôte :', inputId);

        hostConnection.on('open', () => {
            console.log('✅ Connecté à l\'hôte !');
            showView('lobby'); // Afficher le lobby, l'Hôte va envoyer les mises à jour
        });

        // --- LOGIQUE CLIENT : Écouter les données envoyées par l'hôte ---
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
                inputAnswer.focus(); // Met le focus sur le champ pour mobile

                // Activer le chronomètre visuel (côté client)
                resetTimer();
                startTimer(ROUND_DURATION);
            }

            if (data.type === 'ROUND_WON') {
                feedbackMessage.innerText = `🏆 Gagné par ${data.winner} ! \nC'était : ${data.track}`;
                feedbackMessage.style.color = "#1db954"; // Vert
                resetTimer();
            }

            if (data.type === 'END_GAME') {
                showLeaderboard(data.players);
                resetTimer();
            }
        });
    });

    // Écouter les erreurs PeerJS (client)
    peer.on('error', (err) => {
        console.error('❌ Erreur PeerJS Client:', err);
        if (err.type === 'peer-not-found') {
            alert('Code de room introuvable. L\'hôte a-t-il créé la room ?');
        } else {
            alert('Erreur PeerJS, réessayez.');
        }
        showView('home');
    });
});

// Le client envoie sa réponse
document.getElementById('btn-submit-answer').addEventListener('click', () => {
    const answer = inputAnswer.value;
    if (hostConnection && hostConnection.open) {
        hostConnection.send({ type: 'SUBMIT_ANSWER', answer: answer });
        inputAnswer.value = ''; // On vide le champ
        feedbackMessage.innerText = "Réponse envoyée, en attente de validation...";
    }
});


// ==========================================
// 🏆 FONCTION COMMUNE (INTERFACE ET CHRONO)
// ==========================================

// Gestionnaire du chronomètre (pour les clients)
let timerInterval = null;

function resetTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerBar.style.width = '100%';
}

function startTimer(duration) {
    const startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = duration - elapsed;
        
        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerBar.style.width = '0%';
            feedbackMessage.innerText = "Temps écoulé !";
            feedbackMessage.style.color = "orange";
        } else {
            const percentage = (remaining / duration) * 100;
            timerBar.style.width = percentage + '%';
        }
    }, 100); // Mise à jour toutes les 100ms pour une fluidité mobile
}

// Fonction utilitaire pour changer de vue
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

// Affiche le classement final pour tout le monde
function showLeaderboard(playersData) {
    showView('leaderboard');
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    
    // Tri des joueurs par score décroissant
    const sortedPlayers = Object.values(playersData).sort((a, b) => b.score - a.score);
    
    sortedPlayers.forEach((p, index) => {
        list.innerHTML += `<li><strong>#${index + 1} ${p.name}</strong> : ${p.score} pts</li>`;
    });
                                             }
