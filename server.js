const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const admin = require('firebase-admin');

// --- Firebaseの初期化 ---
try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
    console.error("CRITICAL ERROR: serviceAccountKey.json が見つからないか、内容が正しくありません。");
    process.exit(1);
}
const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server);

const TARGETS = [20, 19, 18, 17, 16, 15, 'bull'];
const BULL_VALUE = 25;
const SCORE_CAP = 200;
const MAX_ROUNDS = 15;

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log(`[接続] ユーザー: ${socket.id}`);

    const createRoom = async ({ roomId, playerName }) => {
        if (!roomId || !playerName) return socket.emit('errorMsg', '名前と部屋の名前を入力してください。');
        const roomRef = db.collection('rooms').doc(roomId);
        const doc = await roomRef.get();
        if (doc.exists) return socket.emit('errorMsg', 'エラー: その部屋名は既に使用されています。');

        const newRoomData = {
            id: roomId,
            players: [{ id: socket.id, name: playerName, playerNumber: 1 }],
            createdAt: new Date()
        };
        await roomRef.set(newRoomData);
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
    };

    const joinRoom = async ({ roomId, playerName }) => {
        if (!roomId || !playerName) return socket.emit('errorMsg', '名前と部屋の名前を入力してください。');
        const roomRef = db.collection('rooms').doc(roomId);
        const doc = await roomRef.get();
        if (!doc.exists) return socket.emit('errorMsg', 'エラー: その部屋は存在しません。');
        
        const roomData = doc.data();
        if (roomData.players.length >= 2) return socket.emit('errorMsg', 'エラー: その部屋は満員です。');

        roomData.players.push({ id: socket.id, name: playerName, playerNumber: 2 });
        const gameState = createInitialGameState(roomData);
        
        await roomRef.update({ players: roomData.players, gameState });
        socket.join(roomId);
        io.to(roomId).emit('gameStart', gameState);
    };

    const rollDice = async ({ target }) => {
        const roomInfo = await findRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { roomId, roomData } = roomInfo;
        const roomRef = db.collection('rooms').doc(roomId);
        const { gameState } = roomData;
        if (!gameState) return;

        const player = gameState.players[gameState.currentPlayerIndex];
        if (player.id !== socket.id || gameState.isGameOver || gameState.rollsLeft === 0) return;

        handleRoll(gameState, target);
        checkGameEnd(gameState);
        
        await roomRef.update({ gameState });
        io.to(roomId).emit('updateState', gameState);

        if (gameState.isGameOver) {
            const winner = getWinner(gameState);
            io.to(roomId).emit('gameOver', { winner, finalState: gameState });
        }
    };

    const disconnect = async () => {
        console.log(`[切断] ユーザー: ${socket.id}`);
        const roomInfo = await findRoomBySocketId(socket.id);
        if (roomInfo) {
            const { roomId } = roomInfo;
            await db.collection('rooms').doc(roomId).delete();
            io.to(roomId).emit('opponentLeft');
        }
    };
    
    socket.on('createRoom', createRoom);
    socket.on('joinRoom', joinRoom);
    socket.on('rollDice', rollDice);
    socket.on('disconnect', disconnect);
});

async function findRoomBySocketId(socketId) {
    const roomsRef = db.collection('rooms');
    const allRoomsSnapshot = await roomsRef.get();
    for (const doc of allRoomsSnapshot.docs) {
        const roomData = doc.data();
        if (roomData.players && roomData.players.some(p => p.id === socketId)) {
            return { roomId: doc.id, roomData };
        }
    }
    return null;
}

// --- ゲームロジック ---
function createInitialGameState(roomData) {
    const p1 = roomData.players.find(p => p.playerNumber === 1);
    const p2 = roomData.players.find(p => p.playerNumber === 2);
    return {
        TARGETS, MAX_ROUNDS,
        players: [
            { ...p1, score: 0, marks: createInitialMarks(), stats: createInitialStats() },
            { ...p2, score: 0, marks: createInitialMarks(), stats: createInitialStats() }
        ],
        currentPlayerIndex: 0, round: 1, rollsLeft: 3, isGameOver: false,
    };
}
function createInitialMarks() { return TARGETS.reduce((obj, key) => ({...obj, [key]: 0}), {}); }
function createInitialStats() { return { totalThrows: 0, totalHits: 0, marksScored: 0, totalHitValue: 0 }; }

function handleRoll(gameState, target) {
    const player = gameState.players[gameState.currentPlayerIndex];
    player.stats.totalThrows++;
    const { hitMark, resultText } = calculateRoll(target);
    player.stats.totalHitValue += hitMark;
    if (hitMark > 0) {
        player.stats.totalHits++;
        updateMarksAndScore(gameState, target, hitMark);
    }
    gameState.lastRoll = `${player.name}が ${target.toUpperCase()}に${resultText}`;
    gameState.rollsLeft--;
}

function calculateRoll(target) {
    let hitMark = 0, resultText = '';
    if (target === 'bull') {
        const diceRoll = Math.floor(Math.random() * 6) + 1; // 6面
        // 0:2面, 1:3面, 2:1面
        if (diceRoll <= 2) { hitMark = 0; resultText = 'ブル ミス'; } 
        else if (diceRoll <= 5) { hitMark = 1; resultText = 'シングルブル！'; } 
        else { hitMark = 2; resultText = 'ダブルブル！'; }
    } else {
        const diceRoll = Math.floor(Math.random() * 12) + 1; // 12面
        // 0:2面, 1:6面, 2:1面, 3:3面
        if (diceRoll <= 2) { hitMark = 0; resultText = 'ミス'; } 
        else if (diceRoll <= 8) { hitMark = 1; resultText = 'シングル！'; } 
        else if (diceRoll <= 9) { hitMark = 2; resultText = 'ダブル！'; } 
        else { hitMark = 3; resultText = 'トリプル！'; }
    }
    return { hitMark, resultText };
}

function updateMarksAndScore(gameState, target, hitMark) {
    const player = gameState.players[gameState.currentPlayerIndex];
    const opponent = gameState.players[1 - gameState.currentPlayerIndex];
    const originalHitMark = hitMark;
    const currentMarks = player.marks[target];
    if (currentMarks < 3) {
        const marksToAdd = Math.min(hitMark, 3 - currentMarks);
        player.marks[target] += marksToAdd;
        hitMark -= marksToAdd;
    }
    player.stats.marksScored += (originalHitMark - hitMark);
    if (hitMark > 0 && player.marks[target] === 3 && opponent.marks[target] < 3) {
        const pointValue = (target === 'bull') ? BULL_VALUE : parseInt(target);
        const potentialScore = player.score + (pointValue * hitMark);
        player.score = (potentialScore > opponent.score + SCORE_CAP) ? opponent.score + SCORE_CAP : potentialScore;
    }
}

function checkGameEnd(gameState) {
    if (gameState.rollsLeft > 0) return;
    const p1 = gameState.players[0];
    const p2 = gameState.players[1];
    const p1AllClosed = TARGETS.every(target => p1.marks[target] === 3);
    const p2AllClosed = TARGETS.every(target => p2.marks[target] === 3);
    if ((p1AllClosed && p1.score >= p2.score) || (p2AllClosed && p2.score >= p1.score)) {
        gameState.isGameOver = true; return;
    }
    if (gameState.round >= MAX_ROUNDS && gameState.currentPlayerIndex === 1) {
        gameState.isGameOver = true; return;
    }
    gameState.currentPlayerIndex = 1 - gameState.currentPlayerIndex;
    gameState.rollsLeft = 3;
    if (gameState.currentPlayerIndex === 0) gameState.round++;
}

function getWinner(gameState) {
    const p1 = gameState.players[0];
    const p2 = gameState.players[1];
    if (p1.score > p2.score) return p1;
    if (p2.score > p1.score) return p2;
    const p1Mpr = p1.stats.totalThrows === 0 ? 0 : (p1.stats.totalHitValue / p1.stats.totalThrows);
    const p2Mpr = p2.stats.totalThrows === 0 ? 0 : (p2.stats.totalHitValue / p2.stats.totalThrows);
    if (p1Mpr > p2Mpr) return p1;
    if (p2Mpr > p1Mpr) return p2;
    return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));