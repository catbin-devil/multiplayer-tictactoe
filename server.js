// Express와 Socket.io 라이브러리 불러오기
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Express 앱 생성
const app = express();
const server = http.createServer(app);

// Socket.io 보안 설정
const io = socketIo(server, {
    cors: {
        origin: false // CORS 제한
    },
    maxHttpBufferSize: 1e6, // 1MB 제한
    pingTimeout: 60000,
    pingInterval: 25000
});

// 보안 미들웨어
app.use(express.static(path.join(__dirname)));

// 요청 제한 (간단한 Rate Limiting)
const connections = new Map();

// 메인 페이지 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'multiplayer.html'));
});

// 게임 방 정보 (메모리 정리를 위한 타임아웃 추가)
const rooms = {};
const roomTimeouts = {};

// 입력값 검증 함수
function isValidRoomId(roomId) {
    return typeof roomId === 'string' && 
           roomId.length === 6 && 
           /^[A-Z0-9]+$/.test(roomId);
}

function isValidCellIndex(index) {
    return typeof index === 'number' && 
           index >= 0 && 
           index <= 8 && 
           Number.isInteger(index);
}

// 방 자동 정리 함수
function cleanupRoom(roomId) {
    if (rooms[roomId]) {
        delete rooms[roomId];
        if (roomTimeouts[roomId]) {
            clearTimeout(roomTimeouts[roomId]);
            delete roomTimeouts[roomId];
        }
        console.log(`방 ${roomId}이 정리되었습니다.`);
    }
}

// 클라이언트 연결 제한
io.on('connection', (socket) => {
    const clientIP = socket.handshake.address;
    
    // IP별 연결 수 제한 (최대 5개)
    const currentConnections = connections.get(clientIP) || 0;
    if (currentConnections >= 5) {
        console.log(`IP ${clientIP}에서 너무 많은 연결 시도`);
        socket.disconnect();
        return;
    }
    
    connections.set(clientIP, currentConnections + 1);
    console.log(`새로운 플레이어가 연결되었습니다: ${socket.id} (IP: ${clientIP})`);

    // 방 생성 (입력값 검증 추가)
    socket.on('create-room', (callback) => {
        try {
            // 콜백 함수 존재 확인
            if (typeof callback !== 'function') return;
            
            const roomId = generateRoomId();
            rooms[roomId] = {
                players: [socket.id],
                gameBoard: ['', '', '', '', '', '', '', '', ''],
                currentPlayer: 'X',
                playerSymbols: {
                    [socket.id]: 'X'
                },
                createdAt: Date.now()
            };
            
            socket.join(roomId);
            socket.roomId = roomId;
            
            // 30분 후 자동 정리
            roomTimeouts[roomId] = setTimeout(() => {
                cleanupRoom(roomId);
            }, 30 * 60 * 1000);
            
            console.log(`방 ${roomId}이 생성되었습니다. 플레이어: ${socket.id}`);
            callback({ success: true, roomId, symbol: 'X' });
        } catch (error) {
            console.error('방 생성 오류:', error);
            if (typeof callback === 'function') {
                callback({ success: false, message: '방 생성 실패' });
            }
        }
    });

    // 방 참가 (입력값 검증 강화)
    socket.on('join-room', (roomId, callback) => {
        try {
            // 입력값 검증
            if (!isValidRoomId(roomId) || typeof callback !== 'function') {
                callback({ success: false, message: '잘못된 방 코드입니다.' });
                return;
            }

            const room = rooms[roomId];
            
            if (!room) {
                callback({ success: false, message: '존재하지 않는 방입니다.' });
                return;
            }
            
            if (room.players.length >= 2) {
                callback({ success: false, message: '방이 가득 찼습니다.' });
                return;
            }
            
            // 이미 방에 있는지 확인
            if (room.players.includes(socket.id)) {
                callback({ success: false, message: '이미 이 방에 참가하고 있습니다.' });
                return;
            }
            
            room.players.push(socket.id);
            room.playerSymbols[socket.id] = 'O';
            socket.join(roomId);
            socket.roomId = roomId;
            
            console.log(`플레이어 ${socket.id}가 방 ${roomId}에 참가했습니다.`);
            
            // 방에 있는 모든 플레이어에게 게임 시작 알림
            io.to(roomId).emit('game-start', {
                players: room.players.length,
                playerSymbols: { [socket.id]: 'O' }
            });
            
            callback({ success: true, roomId, symbol: 'O' });
        } catch (error) {
            console.error('방 참가 오류:', error);
            callback({ success: false, message: '방 참가 실패' });
        }
    });

    // 게임 움직임 처리 (입력값 검증 강화)
    socket.on('make-move', (data) => {
        try {
            if (!data || typeof data !== 'object') return;
            
            const { roomId, cellIndex } = data;
            
            // 입력값 검증
            if (!isValidRoomId(roomId) || !isValidCellIndex(cellIndex)) {
                socket.emit('move-error', '잘못된 요청입니다.');
                return;
            }
            
            const room = rooms[roomId];
            if (!room) return;
            
            // 플레이어 권한 확인
            if (!room.players.includes(socket.id)) {
                socket.emit('move-error', '게임에 참가하지 않았습니다.');
                return;
            }
            
            // 현재 플레이어인지 확인
            const playerSymbol = room.playerSymbols[socket.id];
            if (playerSymbol !== room.currentPlayer) {
                socket.emit('move-error', '당신의 차례가 아닙니다.');
                return;
            }
            
            // 셀이 비어있는지 확인
            if (room.gameBoard[cellIndex] !== '') {
                socket.emit('move-error', '이미 선택된 셀입니다.');
                return;
            }
            
            // 움직임 적용
            room.gameBoard[cellIndex] = playerSymbol;
            
            // 승부 확인
            const winner = checkWinner(room.gameBoard);
            const isDraw = !room.gameBoard.includes('') && !winner;
            
            if (winner || isDraw) {
                // 게임 종료
                io.to(roomId).emit('game-over', {
                    board: room.gameBoard,
                    winner: winner,
                    isDraw: isDraw
                });
                
                // 게임 보드 리셋
                room.gameBoard = ['', '', '', '', '', '', '', '', ''];
                room.currentPlayer = 'X';
            } else {
                // 플레이어 교체
                room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';
                
                // 모든 플레이어에게 업데이트 전송
                io.to(roomId).emit('move-made', {
                    board: room.gameBoard,
                    currentPlayer: room.currentPlayer,
                    lastMove: { cellIndex, symbol: playerSymbol }
                });
            }
        } catch (error) {
            console.error('게임 움직임 오류:', error);
            socket.emit('move-error', '게임 오류가 발생했습니다.');
        }
    });

    // 플레이어 연결 해제
    socket.on('disconnect', () => {
        const clientIP = socket.handshake.address;
        const currentConnections = connections.get(clientIP) || 0;
        connections.set(clientIP, Math.max(0, currentConnections - 1));
        
        console.log(`플레이어가 연결을 해제했습니다: ${socket.id}`);
        
        if (socket.roomId) {
            const room = rooms[socket.roomId];
            if (room) {
                // 방에서 플레이어 제거
                room.players = room.players.filter(id => id !== socket.id);
                delete room.playerSymbols[socket.id];
                
                // 방이 비어있으면 즉시 정리
                if (room.players.length === 0) {
                    cleanupRoom(socket.roomId);
                } else {
                    // 남은 플레이어에게 알림
                    io.to(socket.roomId).emit('player-left');
                }
            }
        }
    });

    // 에러 처리
    socket.on('error', (error) => {
        console.error('Socket 오류:', error);
    });
});

// 승자 확인 함수
function checkWinner(board) {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // 가로
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // 세로
        [0, 4, 8], [2, 4, 6] // 대각선
    ];
    
    for (let pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

// 안전한 랜덤 방 ID 생성
function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 보안이 강화된 서버가 http://localhost:${PORT} 에서 실행 중입니다!`);
    console.log('🔒 보안 기능: IP 제한, 입력값 검증, 자동 정리');
    console.log('친구들과 안전하게 게임을 즐겨보세요! 🎮');
});

// 정기적으로 오래된 방 정리 (1시간마다)
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of Object.entries(rooms)) {
        if (now - room.createdAt > 60 * 60 * 1000) { // 1시간
            cleanupRoom(roomId);
        }
    }
}, 60 * 60 * 1000);