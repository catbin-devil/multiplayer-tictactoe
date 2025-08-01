const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname)));

// 게임 상태 관리
const gameRooms = new Map();
const playerStats = {
    totalPlayers: 0,
    games: {
        tictactoe: { players: 0, rooms: 0 },
        gomoku: { players: 0, rooms: 0 },
        chess: { players: 0, rooms: 0 }
    }
};

// 방 코드 생성 함수
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 틱택토 승리 조건 확인
function checkTicTacToeWinner(board) {
    const winConditions = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // 가로
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // 세로
        [0, 4, 8], [2, 4, 6] // 대각선
    ];

    for (let condition of winConditions) {
        const [a, b, c] = condition;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], winningCells: condition };
        }
    }

    if (board.every(cell => cell !== '')) {
        return { isDraw: true };
    }

    return null;
}

// 오목 승리 조건 확인
function checkGomokuWinner(board, lastMove) {
    const directions = [
        [1, 0], [0, 1], [1, 1], [1, -1] // 가로, 세로, 대각선
    ];
    
    const row = Math.floor(lastMove / 15);
    const col = lastMove % 15;
    const player = board[lastMove];

    for (let [dx, dy] of directions) {
        let count = 1;
        let winningCells = [lastMove];

        // 한 방향으로 확인
        for (let i = 1; i < 5; i++) {
            const newRow = row + i * dx;
            const newCol = col + i * dy;
            const index = newRow * 15 + newCol;
            
            if (newRow >= 0 && newRow < 15 && newCol >= 0 && newCol < 15 && board[index] === player) {
                count++;
                winningCells.push(index);
            } else {
                break;
            }
        }

        // 반대 방향으로 확인
        for (let i = 1; i < 5; i++) {
            const newRow = row - i * dx;
            const newCol = col - i * dy;
            const index = newRow * 15 + newCol;
            
            if (newRow >= 0 && newRow < 15 && newCol >= 0 && newCol < 15 && board[index] === player) {
                count++;
                winningCells.push(index);
            } else {
                break;
            }
        }

        if (count >= 5) {
            return { winner: player, winningCells };
        }
    }

    return null;
}

// 체스 승리 조건 확인 (간단한 체크메이트 체크)
function checkChessWinner(board, lastMove) {
    // 여기서는 간단한 구현만 제공
    // 실제 체스 로직은 더 복잡합니다
    return null;
}

// 게임별 승리 조건 확인
function checkWinner(gameType, board, lastMove) {
    switch (gameType) {
        case 'tictactoe':
            return checkTicTacToeWinner(board);
        case 'gomoku':
            return checkGomokuWinner(board, lastMove);
        case 'chess':
            return checkChessWinner(board, lastMove);
        default:
            return null;
    }
}

// 통계 업데이트
function updateStats() {
    let totalPlayers = 0;
    let gameStats = { tictactoe: { players: 0, rooms: 0 }, gomoku: { players: 0, rooms: 0 }, chess: { players: 0, rooms: 0 } };

    for (let [roomId, room] of gameRooms) {
        if (room.players.length > 0) {
            gameStats[room.gameType].players += room.players.length;
            gameStats[room.gameType].rooms++;
            totalPlayers += room.players.length;
        }
    }

    playerStats.totalPlayers = totalPlayers;
    playerStats.games = gameStats;

    io.emit('game-stats', playerStats);
}

// Socket.IO 연결 처리
io.on('connection', (socket) => {
    console.log(`🟢 새로운 플레이어 연결: ${socket.id}`);
    
    let currentRoom = null;
    let playerSymbol = null;

    // 방 생성
    socket.on('create-room', (gameType, callback) => {
        const roomId = generateRoomCode();
        const symbol = 'X'; // 방 생성자는 항상 X

        gameRooms.set(roomId, {
            gameType: gameType,
            players: [{ id: socket.id, symbol: symbol }],
            board: gameType === 'gomoku' ? new Array(225).fill('') : new Array(9).fill(''),
            currentPlayer: 'X',
            gameStarted: false
        });

        currentRoom = roomId;
        playerSymbol = symbol;

        console.log(`🏠 방 생성: ${roomId} (${gameType})`);
        updateStats();
        
        callback({ success: true, roomId: roomId, symbol: symbol });
    });

    // 방 참가
    socket.on('join-room', (gameType, roomId, callback) => {
        const room = gameRooms.get(roomId);
        
        if (!room) {
            callback({ success: false, message: '존재하지 않는 방입니다.' });
            return;
        }

        if (room.players.length >= 2) {
            callback({ success: false, message: '방이 가득 찼습니다.' });
            return;
        }

        if (room.gameType !== gameType) {
            callback({ success: false, message: '게임 타입이 일치하지 않습니다.' });
            return;
        }

        const symbol = room.players[0].symbol === 'X' ? 'O' : 'X';
        room.players.push({ id: socket.id, symbol: symbol });
        
        currentRoom = roomId;
        playerSymbol = symbol;

        // 게임 시작
        room.gameStarted = true;
        socket.join(roomId);
        socket.to(roomId).emit('game-start', { board: room.board });

        console.log(`🚪 방 참가: ${roomId} (${gameType}) - ${symbol}`);
        updateStats();
        
        callback({ success: true, roomId: roomId, symbol: symbol });
    });

    // 게임 움직임
    socket.on('make-move', (data) => {
        const room = gameRooms.get(data.roomId);
        
        if (!room || !room.gameStarted) {
            socket.emit('move-error', '게임이 시작되지 않았습니다.');
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            socket.emit('move-error', '플레이어를 찾을 수 없습니다.');
            return;
        }

        if (room.currentPlayer !== player.symbol) {
            socket.emit('move-error', '당신의 차례가 아닙니다.');
            return;
        }

        if (room.board[data.cellIndex] !== '') {
            socket.emit('move-error', '이미 놓인 위치입니다.');
            return;
        }

        // 움직임 실행
        room.board[data.cellIndex] = player.symbol;
        room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';

        // 승리 조건 확인
        const winner = checkWinner(room.gameType, room.board, data.cellIndex);
        
        if (winner) {
            // 게임 종료
            io.to(data.roomId).emit('game-over', {
                board: room.board,
                winner: winner.winner,
                isDraw: winner.isDraw,
                winningCells: winner.winningCells
            });

            // 방 정리
            setTimeout(() => {
                if (gameRooms.has(data.roomId)) {
                    const room = gameRooms.get(data.roomId);
                    room.board = room.gameType === 'gomoku' ? new Array(225).fill('') : new Array(9).fill('');
                    room.currentPlayer = 'X';
                    io.to(data.roomId).emit('game-start', { board: room.board });
                }
            }, 3000);
        } else {
            // 게임 계속
            io.to(data.roomId).emit('move-made', {
                board: room.board,
                currentPlayer: room.currentPlayer
            });
        }
    });

    // 연결 해제
    socket.on('disconnect', () => {
        console.log(`🔴 플레이어 연결 해제: ${socket.id}`);
        
        if (currentRoom) {
            const room = gameRooms.get(currentRoom);
            if (room) {
                room.players = room.players.filter(p => p.id !== socket.id);
                
                if (room.players.length === 0) {
                    // 방 삭제
                    gameRooms.delete(currentRoom);
                    console.log(`🗑️ 방 삭제: ${currentRoom}`);
                } else {
                    // 다른 플레이어에게 알림
                    socket.to(currentRoom).emit('player-left');
                }
            }
        }
        
        updateStats();
    });

    // 통계 요청
    socket.on('request-stats', () => {
        updateStats();
    });
});

// 라우트 설정
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'lobby.html'));
});

app.get('/tictactoe.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'multiplayer.html'));
});

app.get('/gomoku.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'multiplayer.html'));
});

app.get('/chess.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'multiplayer.html'));
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다!`);
    console.log(`📱 로컬: http://localhost:${PORT}`);
    console.log(`🎮 멀티플레이어 게임 플랫폼이 준비되었습니다!`);
});

// 주기적으로 통계 업데이트
setInterval(updateStats, 5000);

// 에러 처리
process.on('uncaughtException', (err) => {
    console.error('❌ 예상치 못한 오류:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 처리되지 않은 Promise 거부:', reason);
});