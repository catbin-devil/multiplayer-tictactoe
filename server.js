// 수정된 간단한 서버
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname)));

// 라우트 설정
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'lobby.html'));
});

app.get('/tictactoe.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'tictactoe.html'));
});

app.get('/gomoku.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'gomoku.html'));
});

app.get('/chess.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'chess.html'));
});

// 게임 방 저장소
const rooms = {};

// 랜덤 방 ID 생성
function generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// 초기 보드 생성
function createInitialBoard(gameType) {
    switch (gameType) {
        case 'tictactoe':
            return new Array(9).fill('');
        case 'gomoku':
            return new Array(225).fill('');
        case 'chess':
            return [
                'r','n','b','q','k','b','n','r',
                'p','p','p','p','p','p','p','p',
                '','','','','','','','',
                '','','','','','','','',
                '','','','','','','','',
                '','','','','','','','',
                'P','P','P','P','P','P','P','P',
                'R','N','B','Q','K','B','N','R'
            ];
        default:
            return [];
    }
}

// 승리 확인 함수들
function checkWinner(gameType, board) {
    if (gameType === 'tictactoe') {
        return checkTictactoeWinner(board);
    } else if (gameType === 'gomoku') {
        return checkGomokuWinner(board);
    } else if (gameType === 'chess') {
        return checkChessWinner(board);
    }
    return null;
}

function checkTictactoeWinner(board) {
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

function checkGomokuWinner(board) {
    for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 15; col++) {
            const index = row * 15 + col;
            const player = board[index];
            
            if (!player) continue;
            
            // 가로 확인
            if (col <= 10) {
                let count = 0;
                for (let i = 0; i < 5; i++) {
                    if (board[row * 15 + col + i] === player) count++;
                    else break;
                }
                if (count === 5) return player;
            }
            
            // 세로 확인
            if (row <= 10) {
                let count = 0;
                for (let i = 0; i < 5; i++) {
                    if (board[(row + i) * 15 + col] === player) count++;
                    else break;
                }
                if (count === 5) return player;
            }
            
            // 대각선 확인 (↘)
            if (row <= 10 && col <= 10) {
                let count = 0;
                for (let i = 0; i < 5; i++) {
                    if (board[(row + i) * 15 + col + i] === player) count++;
                    else break;
                }
                if (count === 5) return player;
            }
            
            // 대각선 확인 (↙)
            if (row <= 10 && col >= 4) {
                let count = 0;
                for (let i = 0; i < 5; i++) {
                    if (board[(row + i) * 15 + col - i] === player) count++;
                    else break;
                }
                if (count === 5) return player;
            }
        }
    }
    return null;
}

function checkChessWinner(board) {
    let whiteKing = false;
    let blackKing = false;
    
    for (let piece of board) {
        if (piece === 'K') whiteKing = true;
        if (piece === 'k') blackKing = true;
    }
    
    if (!whiteKing) return 'black';
    if (!blackKing) return 'white';
    return null;
}

// Socket.io 연결 처리
io.on('connection', (socket) => {
    console.log('플레이어 연결:', socket.id);

    // 방 생성
    socket.on('create-room', (gameType, callback) => {
        try {
            console.log(`방 생성 요청: ${gameType}`);
            
            const roomId = generateRoomId();
            const initialBoard = createInitialBoard(gameType);
            let initialPlayer, playerSymbol;
            
            if (gameType === 'chess') {
                initialPlayer = 'white';
                playerSymbol = 'white';
            } else {
                initialPlayer = 'X';
                playerSymbol = 'X';
            }
            
            rooms[roomId] = {
                gameType: gameType,
                players: [socket.id],
                gameBoard: initialBoard,
                currentPlayer: initialPlayer,
                playerSymbols: {
                    [socket.id]: playerSymbol
                }
            };
            
            socket.join(roomId);
            socket.roomId = roomId;
            socket.gameType = gameType;
            
            console.log(`방 ${roomId} 생성됨 (${gameType})`);
            callback({ success: true, roomId, symbol: playerSymbol });
            
        } catch (error) {
            console.error('방 생성 오류:', error);
            callback({ success: false, message: '방 생성 실패: ' + error.message });
        }
    });

    // 방 참가
    socket.on('join-room', (gameType, roomId, callback) => {
        try {
            console.log(`방 참가 요청: ${gameType}, 방: ${roomId}`);
            
            const room = rooms[roomId];
            
            if (!room) {
                callback({ success: false, message: '존재하지 않는 방입니다.' });
                return;
            }
            
            if (room.players.length >= 2) {
                callback({ success: false, message: '방이 가득 찼습니다.' });
                return;
            }
            
            let playerSymbol;
            if (gameType === 'chess') {
                playerSymbol = 'black';
            } else {
                playerSymbol = 'O';
            }
            
            room.players.push(socket.id);
            room.playerSymbols[socket.id] = playerSymbol;
            socket.join(roomId);
            socket.roomId = roomId;
            socket.gameType = gameType;
            
            // 게임 시작 알림
            io.to(roomId).emit('game-start', {
                players: room.players.length,
                playerSymbols: room.playerSymbols,
                gameBoard: room.gameBoard,
                currentPlayer: room.currentPlayer
            });
            
            console.log(`플레이어가 방 ${roomId}에 참가함`);
            callback({ success: true, roomId, symbol: playerSymbol });
            
        } catch (error) {
            console.error('방 참가 오류:', error);
            callback({ success: false, message: '방 참가 실패: ' + error.message });
        }
    });
// server.js에서 체스 관련 부분 수정

// 게임 움직임 처리 (수정된 버전)
socket.on('make-move', (data) => {
    try {
        const { roomId, cellIndex, gameType, fromIndex } = data;
        const room = rooms[roomId];
        
        if (!room) return;
        
        const playerSymbol = room.playerSymbols[socket.id];
        if (playerSymbol !== room.currentPlayer) {
            socket.emit('move-error', '당신의 차례가 아닙니다.');
            return;
        }
        
        // 체스의 경우 특별 처리
        if (gameType === 'chess') {
            // fromIndex가 있어야 함 (체스는 기물을 선택 후 이동)
            if (fromIndex === undefined || cellIndex === undefined) {
                socket.emit('move-error', '잘못된 이동입니다.');
                return;
            }
            
            const fromPiece = room.gameBoard[fromIndex];
            const toPiece = room.gameBoard[cellIndex];
            
            // 자신의 기물인지 확인
            const isMyPiece = playerSymbol === 'white' ? 
                (fromPiece && fromPiece === fromPiece.toUpperCase()) :
                (fromPiece && fromPiece === fromPiece.toLowerCase());
                
            if (!isMyPiece) {
                socket.emit('move-error', '자신의 기물만 움직일 수 있습니다.');
                return;
            }
            
            // 기물 이동
            room.gameBoard[cellIndex] = fromPiece;
            room.gameBoard[fromIndex] = '';
            
            // 승부 확인
            const winner = checkChessWinner(room.gameBoard);
            
            if (winner) {
                // 체스 게임 종료
                io.to(roomId).emit('game-over', {
                    board: room.gameBoard,
                    winner: winner,
                    isDraw: false
                });
                
                // 게임 보드 리셋
                room.gameBoard = createInitialBoard(gameType);
                room.currentPlayer = 'white';
            } else {
                // 플레이어 교체
                room.currentPlayer = room.currentPlayer === 'white' ? 'black' : 'white';
                
                // 모든 플레이어에게 업데이트 전송
                io.to(roomId).emit('move-made', {
                    board: room.gameBoard,
                    currentPlayer: room.currentPlayer,
                    lastMove: { 
                        fromIndex: fromIndex, 
                        cellIndex: cellIndex, 
                        piece: fromPiece,
                        capturedPiece: toPiece || null
                    }
                });
            }
        } else {
            // 틱택토, 오목의 기존 로직
            if (room.gameBoard[cellIndex] !== '') {
                socket.emit('move-error', '이미 선택된 위치입니다.');
                return;
            }
            
            // 움직임 적용
            room.gameBoard[cellIndex] = playerSymbol;
            
            // 승부 확인
            const winner = checkWinner(gameType, room.gameBoard);
            const isDraw = !room.gameBoard.includes('') && !winner;
            
            if (winner || isDraw) {
                // 게임 종료
                io.to(roomId).emit('game-over', {
                    board: room.gameBoard,
                    winner: winner,
                    isDraw: isDraw
                });
                
                // 게임 보드 리셋
                room.gameBoard = createInitialBoard(gameType);
                room.currentPlayer = gameType === 'chess' ? 'white' : 'X';
            } else {
                // 플레이어 교체
                if (gameType === 'chess') {
                    room.currentPlayer = room.currentPlayer === 'white' ? 'black' : 'white';
                } else {
                    room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';
                }
                
                // 모든 플레이어에게 업데이트 전송
                io.to(roomId).emit('move-made', {
                    board: room.gameBoard,
                    currentPlayer: room.currentPlayer,
                    lastMove: { cellIndex, symbol: playerSymbol }
                });
            }
        }
        
    } catch (error) {
        console.error('게임 움직임 오류:', error);
        socket.emit('move-error', '게임 오류가 발생했습니다.');
    }
});

    // 연결 해제
    socket.on('disconnect', () => {
        console.log('플레이어 연결 해제:', socket.id);
        
        if (socket.roomId) {
            const room = rooms[socket.roomId];
            if (room) {
                room.players = room.players.filter(id => id !== socket.id);
                delete room.playerSymbols[socket.id];
                
                if (room.players.length === 0) {
                    delete rooms[socket.roomId];
                } else {
                    io.to(socket.roomId).emit('player-left');
                }
            }
        }
    });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 수정된 서버가 http://localhost:${PORT} 에서 실행 중입니다!`);
    console.log('🎮 지원 게임: 틱택토, 오목, 체스');
});