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
        // ▼▼▼ 通信が届いたことを記録するログを追加 ▼▼▼
        console.log(`[受信] createRoomイベント。部屋ID: ${roomId}, プレイヤー名: ${playerName}`);

        if (!roomId || !playerName) {
            console.log('[エラー] 部屋IDまたはプレイヤー名がありません。');
            return socket.emit('errorMsg', '名前と部屋の名前を入力してください。');
        }
        
        try {
            const roomRef = db.collection('rooms').doc(roomId);
            const doc = await roomRef.get();

            if (doc.exists) {
                console.log(`[エラー] 部屋[${roomId}]は既に存在します。`);
                return socket.emit('errorMsg', 'エラー: その部屋名は既に使用されています。');
            }

            const newRoomData = {
                id: roomId,
                players: [{ id: socket.id, name: playerName, playerNumber: 1 }],
                createdAt: new Date()
            };
            await roomRef.set(newRoomData);
            
            socket.join(roomId);
            console.log(`[成功] 部屋[${roomId}]を作成し、クライアントにイベントを送信します。`);
            socket.emit('roomCreated', { roomId, playerId: socket.id });

        } catch (error) {
            console.error('[Firestoreエラー] 部屋作成中にエラーが発生しました:', error);
            socket.emit('errorMsg', 'サーバーエラーが発生しました。しばらくしてから再度お試しください。');
        }
    };

    const joinRoom = async ({ roomId, playerName }) => {
        console.log(`[受信] joinRoomイベント。部屋ID: ${roomId}, プレイヤー名: ${playerName}`);
        if (!roomId || !playerName) return socket.emit('errorMsg', '名前と部屋の名前を入力してください。');
        
        try {
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
        } catch (error) {
            console.error('[Firestoreエラー] 部屋参加中にエラーが発生しました:', error);
            socket.emit('errorMsg', 'サーバーエラーが発生しました。しばらくしてから再度お試しください。');
        }
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

// --- ゲームロジック（変更なし） ---
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
    const opponent = gameState.players[1 - gameState.currentPlayerIndex];
    player.stats.totalThrows++;
    const isClosedByBoth = player.marks[target] === 3 && opponent.marks[target] === 3;
    let { hitMark, resultText }