const socket = io();

// ...（HTML要素取得部分は変更なし）...
let myPlayerId = null;
let currentGameState = null;

// ...（イベントリスナー部分は変更なし）...

// --- UI更新関数 ---
function showGameContainer() {
    document.getElementById('room-container').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');
}

function buildUIElements(gameState) {
    const { players, TARGETS } = gameState;
    const me = players.find(p => p.id === myPlayerId);
    const opponent = players.find(p => p.id !== myPlayerId);
    
    const p1 = me.playerNumber === 1 ? me : opponent;
    const p2 = me.playerNumber === 2 ? me : opponent;

    document.getElementById('p1-header').textContent = p1 ? p1.name : '待機中...';
    document.getElementById('p2-header').textContent = p2 ? p2.name : '待機中...';

    const scoreboardBody = document.querySelector('#scoreboard tbody');
    scoreboardBody.innerHTML = '';
    TARGETS.forEach(target => {
        const row = document.createElement('tr');
        row.id = `row-${target}`; // 行にIDを付与
        row.innerHTML = `<td class="marks player-1-color" id="p1-marks-${target}"></td><td class="number-cell">${target.toString().toUpperCase()}</td><td class="marks player-2-color" id="p2-marks-${target}"></td>`;
        scoreboardBody.appendChild(row);
    });

    const targetButtonsContainer = document.getElementById('target-buttons');
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
    const { players, round, currentPlayerIndex, rollsLeft, isGameOver, lastRoll, TARGETS, MAX_ROUNDS } = gameState;
    const me = players.find(p => p.id === myPlayerId);
    if (!me) return;
    
    const opponent = players.find(p => p.id !== myPlayerId);
    if (!opponent && !isGameOver) return;

    const p1 = me.playerNumber === 1 ? me : opponent;
    const p2 = me.playerNumber === 2 ? me : opponent;
    const currentPlayer = players[currentPlayerIndex];

    if (p1) {
        document.getElementById('p1-score').textContent = p1.score;
        document.getElementById('p1-mpr-live').textContent = p1.stats.totalThrows === 0 ? '0.00' : (p1.stats.totalHitValue / p1.stats.totalThrows * 3).toFixed(2);
    }
    if (p2) {
        document.getElementById('p2-score').textContent = p2.score;
        document.getElementById('p2-mpr-live').textContent = p2.stats.totalThrows === 0 ? '0.00' : (p2.stats.totalHitValue / p2.stats.totalThrows * 3).toFixed(2);
    }
    
    TARGETS.forEach(target => {
        if (p1) document.getElementById(`p1-marks-${target}`).textContent = '●'.repeat(p1.marks[target]);
        if (p2) document.getElementById(`p2-marks-${target}`).textContent = '●'.repeat(p2.marks[target]);
        
        // ▼▼▼ ここからが修正部分です ▼▼▼
        const row = document.getElementById(`row-${target}`);
        if(row && p1 && p2) {
            // 両プレイヤーが3マークなら .closed-by-both クラスを付与
            if (p1.marks[target] === 3 && p2.marks[target] === 3) {
                row.classList.add('closed-by-both');
            } else {
                row.classList.remove('closed-by-both');
            }
        }
        // ▲▲▲ ここまで ▲▲▲
    });

    document.getElementById('round-counter').textContent = Math.min(round, MAX_ROUNDS);
    if (!isGameOver) {
        document.getElementById('current-player').innerHTML = `<span class="${currentPlayer.playerNumber === 1 ? 'player-1-color' : 'player-2-color'}">${currentPlayer.name}</span> のターン`;
        document.getElementById('rolls-left').textContent = rollsLeft;
        document.getElementById('target-buttons').style.pointerEvents = (currentPlayer.id === myPlayerId) ? 'auto' : 'none';
        if(lastRoll) document.getElementById('message-log').textContent = lastRoll;
    }
    
    if (isGameOver && p1 && p2) {
        const statsGrid = document.getElementById('stats-grid');
        const p1HitRate = p1.stats.totalThrows === 0 ? 0 : (p1.stats.totalHits / p1.stats.totalThrows * 100).toFixed(1);
        const p1Mpr = p1.stats.totalThrows === 0 ? 0 : (p1.stats.totalHitValue / p1.stats.totalThrows * 3).toFixed(2);
        const p2HitRate = p2.stats.totalThrows === 0 ? 0 : (p2.stats.totalHits / p2.stats.totalThrows * 100).toFixed(1);
        const p2Mpr = p2.stats.totalThrows === 0 ? 0 : (p2.stats.totalHitValue / p2.stats.totalThrows * 3).toFixed(2);
        
        document.getElementById('p1-header').textContent = p1.name;
        document.getElementById('p2-header').textContent = p2.name;

        statsGrid.innerHTML = `
            <div><h3 class="${p1.playerNumber === 1 ? 'player-1-color' : 'player-2-color'}">${p1.name}</h3><p>ヒット率: ${p1HitRate}%</p><p>MPR: ${p1Mpr}</p></div>
            <div><h3 class="${p2.playerNumber === 1 ? 'player-1-color' : 'player-2-color'}">${p2.name}</h3><p>ヒット率: ${p2HitRate}%</p><p>MPR: ${p2Mpr}</p></div>
        `;
    }
}

// --- その他の関数（変更なし） ---
// (socket.on, showGameContainer, buildUIElements, etc.)
// (server.js は変更なし)