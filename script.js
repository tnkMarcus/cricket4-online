const socket = io();

// --- HTML要素を取得 ---
const roomContainer = document.getElementById('room-container');
const gameContainer = document.getElementById('game-container');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomIdInput = document.getElementById('room-id-input');
const targetButtonsContainer = document.getElementById('target-buttons');
const messageLogEl = document.getElementById('message-log');
const leaveRoomBtn = document.getElementById('leave-room-btn');

let myPlayerId = null;
let currentGameState = null;

// --- イベントリスナー ---
createRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (roomId) socket.emit('createRoom', { roomId });
});
joinRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (roomId) socket.emit('joinRoom', { roomId });
});
targetButtonsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('target-btn')) {
        socket.emit('rollDice', { target: e.target.dataset.value });
    }
});
leaveRoomBtn.addEventListener('click', () => location.reload());

// --- サーバーからのイベント受信 ---
socket.on('roomCreated', ({ roomId, playerId }) => {
    myPlayerId = playerId;
    showGameContainer();
    messageLogEl.textContent = `部屋[${roomId}]を作成しました。相手を待っています...`;
});

socket.on('gameStart', (gameState) => {
    console.log("Game Start event received", gameState);
    if (!myPlayerId) myPlayerId = socket.id;
    currentGameState = gameState;
    showGameContainer();
    buildUIElements(currentGameState);
    updateUI(currentGameState);
});

socket.on('updateState', (gameState) => {
    console.log("Update State event received", gameState);
    currentGameState = gameState;
    updateUI(currentGameState);
});

socket.on('gameOver', ({ winner }) => {
    console.log("Game Over event received", winner);
    const winnerPlayer = currentGameState.players.find(p => p.id === winner?.id);
    const message = winnerPlayer ? `<span class="${winnerPlayer.playerNumber === 1 ? 'player-1-color' : 'player-2-color'}">${winnerPlayer.name} の勝利！</span>` : "引き分け！";
    messageLogEl.innerHTML = message;
    messageLogEl.classList.add('winner-message');
    document.getElementById('stats-container').classList.remove('hidden');
    targetButtonsContainer.style.pointerEvents = 'none';
});

socket.on('errorMsg', (message) => alert(message));
socket.on('opponentLeft', () => {
    alert('相手が退出しました。');
    location.reload();
});

// --- UI更新関数 ---
function showGameContainer() {
    roomContainer.classList.add('hidden');
    gameContainer.classList.remove('hidden');
}

function buildUIElements(gameState) {
    const { players, TARGETS } = gameState;
    const me = players.find(p => p.id === myPlayerId);
    // 相手がまだいない場合(部屋作成直後)を考慮
    const opponent = players.find(p => p.id !== myPlayerId); 
    
    // 自分を左側(P1)に表示
    const p1 = me.playerNumber === 1 ? me : opponent;
    const p2 = me.playerNumber === 2 ? me : opponent;

    document.getElementById('p1-header').textContent = p1 ? p1.name : '待機中...';
    document.getElementById('p2-header').textContent = p2 ? p2.name : '待機中...';

    const scoreboardBody = document.querySelector('#scoreboard tbody');
    scoreboardBody.innerHTML = '';
    TARGETS.forEach(target => {
        const row = document.createElement('tr');
        row.innerHTML = `<td class="marks player-1-color" id="p1-marks-${target}"></td><td class="number-cell">${target.toString().toUpperCase()}</td><td class="marks player-2-color" id="p2-marks-${target}"></td>`;
        scoreboardBody.appendChild(row);
    });

    targetButtonsContainer.innerHTML = '';
    TARGETS.forEach(target => {
        const button = document.createElement('button');
        button.classList.add('target-btn');
        button.textContent = target.toString().toUpperCase();
        button.dataset.value = target;
        targetButtonsContainer.appendChild(button);
    });
}

function updateUI(gameState) {
    const { players, round, currentPlayerIndex, rollsLeft, isGameOver, lastRoll, TARGETS } = gameState;
    const me = players.find(p => p.id === myPlayerId);
    const opponent = players.find(p => p.id !== myPlayerId);
    const p1 = me.playerNumber === 1 ? me : opponent;
    const p2 = me.playerNumber === 2 ? me : opponent;
    const currentPlayer = players[currentPlayerIndex];

    document.getElementById('p1-score').textContent = p1.score;
    document.getElementById('p2-score').textContent = p2.score;
    document.getElementById('p1-mpr-live').textContent = p1.stats.totalThrows === 0 ? '0.00' : (p1.stats.totalHitValue / p1.stats.totalThrows * 3).toFixed(2);
    document.getElementById('p2-mpr-live').textContent = p2.stats.totalThrows === 0 ? '0.00' : (p2.stats.totalHitValue / p2.stats.totalThrows * 3).toFixed(2);
    
    TARGETS.forEach(target => {
        document.getElementById(`p1-marks-${target}`).textContent = '●'.repeat(p1.marks[target]);
        document.getElementById(`p2-marks-${target}`).textContent = '●'.repeat(p2.marks[target]);
        const row = document.getElementById(`row-${target}`);
        if(row) row.classList.toggle('closed-by-both', p1.marks[target] === 3 && p2.marks[target] === 3);
    });

    document.getElementById('round-counter').textContent = Math.min(round, 15);
    if (!isGameOver) {
        document.getElementById('current-player').innerHTML = `<span class="${currentPlayer.playerNumber === 1 ? 'player-1-color' : 'player-2-color'}">${currentPlayer.name}</span> のターン`;
        document.getElementById('rolls-left').textContent = rollsLeft;
        targetButtonsContainer.style.pointerEvents = (currentPlayer.id === myPlayerId) ? 'auto' : 'none';
        if(lastRoll) messageLogEl.textContent = lastRoll;
    }
    
    if (isGameOver) {
        document.getElementById('stats-grid').innerHTML = `
            <div><h3 class="${p1.playerNumber === 1 ? 'player-1-color' : 'player-2-color'}">${p1.name}</h3><p>ヒット率: ${(p1.stats.totalThrows === 0 ? 0 : (p1.stats.totalHits / p1.stats.totalThrows * 100)).toFixed(1)}%</p><p>MPR: ${(p1.stats.totalThrows === 0 ? 0 : (p1.stats.totalHitValue / p1.stats.totalThrows * 3)).toFixed(2)}</p></div>
            <div><h3 class="${p2.playerNumber === 1 ? 'player-1-color' : 'player-2-color'}">${p2.name}</h3><p>ヒット率: ${(p2.stats.totalThrows === 0 ? 0 : (p2.stats.totalHits / p2.stats.totalThrows * 100)).toFixed(1)}%</p><p>MPR: ${(p2.stats.totalThrows === 0 ? 0 : (p2.stats.totalHitValue / p2.stats.totalThrows * 3)).toFixed(2)}</p></div>
        `;
    }
}