const express = require('express');
const socketIo = require('socket.io');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Подключаемся к базе данных
const dbPath = path.join(__dirname, 'neocord.db');
const db = new sqlite3.Database(dbPath);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Маршрут для главной страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        console.log('📝 Попытка регистрации:', username);

        if (!username || !password) {
            return res.status(400).json({ error: 'Заполните имя и пароль' });
        }

        // Проверяем существование пользователя
        db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
            if (err) {
                console.error('❌ Ошибка базы:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            if (row) {
                return res.status(400).json({ error: 'Имя пользователя занято' });
            }

            // Хешируем пароль
            const hashedPassword = await bcrypt.hash(password, 10);
            const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=7289da&color=fff&size=256`;

            // Сохраняем пользователя
            db.run(
                'INSERT INTO users (username, password, email, avatar) VALUES (?, ?, ?, ?)',
                [username, hashedPassword, email, avatar],
                function(err) {
                    if (err) {
                        console.error('❌ Ошибка сохранения:', err);
                        return res.status(500).json({ error: 'Ошибка при создании пользователя' });
                    }

                    console.log('✅ Пользователь создан. ID:', this.lastID);
                    
                    res.json({
                        success: true,
                        message: 'Пользователь создан!',
                        user: {
                            id: this.lastID,
                            username,
                            avatar
                        }
                    });
                }
            );
        });

    } catch (error) {
        console.error('❌ Ошибка регистрации:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Вход пользователя
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('🔐 Попытка входа:', username);

        if (!username || !password) {
            return res.status(400).json({ error: 'Заполните имя и пароль' });
        }

        // Ищем пользователя
        db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
            if (err) {
                console.error('❌ Ошибка базы:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            if (!user) {
                return res.status(400).json({ error: 'Неверные данные' });
            }

            // Проверяем пароль
            const isValid = await bcrypt.compare(password, user.password);
            if (!isValid) {
                return res.status(400).json({ error: 'Неверные данные' });
            }

            // Обновляем статус
            db.run('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);

            res.json({
                success: true,
                message: 'Вход выполнен!',
                user: {
                    id: user.id,
                    username: user.username,
                    avatar: user.avatar
                }
            });
        });

    } catch (error) {
        console.error('❌ Ошибка входа:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получаем список комнат
app.get('/api/rooms', (req, res) => {
    db.all('SELECT * FROM rooms ORDER BY name', (err, rooms) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        res.json(rooms);
    });
});

// Получаем онлайн пользователей
app.get('/api/online-users', (req, res) => {
    db.all('SELECT id, username, avatar, status FROM users WHERE status = ?', ['online'], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        res.json(users);
    });
});

// WebSocket соединения
const activeUsers = new Map();
const voiceUsers = new Map();

// Функция для обновления списка онлайн пользователей
function updateOnlineUsers() {
    const onlineUsers = Array.from(activeUsers.values()).map(user => ({
        id: user.userId,
        username: user.username,
        avatar: user.avatar,
        status: 'online'
    }));
    
    // Отправляем всем подключенным клиентам
    io.emit('online-users', onlineUsers);
}

// Функция для обновления пользователей в голосовом чате
function updateVoiceUsers(roomId) {
    const voiceUsersList = Array.from(voiceUsers.values())
        .filter(user => user.roomId === roomId)
        .map(user => ({
            id: user.userId,
            username: user.username,
            avatar: user.avatar
        }));
    
    io.to(roomId).emit('voice-users-update', voiceUsersList);
}

io.on('connection', (socket) => {
    console.log('🔗 Новое подключение:', socket.id);

    // Аутентификация пользователя
    socket.on('authenticate', (userData) => {
        console.log('🔐 Попытка WebSocket аутентификации:', userData);
        
        // Проверяем пользователя в базе
        db.get('SELECT * FROM users WHERE id = ?', [userData.userId], (err, user) => {
            if (err || !user) {
                console.log('❌ WebSocket аутентификация failed: пользователь не найден');
                socket.emit('auth-error', 'Пользователь не найден');
                return;
            }

            console.log('✅ WebSocket аутентификация успешна:', user.username);
            
            // Сохраняем пользователя
            activeUsers.set(socket.id, {
                userId: user.id,
                username: user.username,
                avatar: user.avatar,
                socketId: socket.id
            });

            // Отправляем подтверждение клиенту
            socket.emit('authenticated', {
                user: {
                    id: user.id,
                    username: user.username,
                    avatar: user.avatar
                }
            });

            // Отправляем комнаты
            db.all('SELECT * FROM rooms ORDER BY name', (err, rooms) => {
                if (err) {
                    console.error('❌ Ошибка загрузки комнат:', err);
                    return;
                }
                socket.emit('rooms-list', rooms);
            });

            // Отправляем онлайн пользователей
            updateOnlineUsers();

            // Обновляем статус в базе
            db.run('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);
        });
    });

    // Присоединение к комнате
    socket.on('join-room', (roomId) => {
        const user = activeUsers.get(socket.id);
        if (!user) {
            console.log('❌ Пользователь не аутентифицирован для комнаты');
            return;
        }

        console.log(`🎯 ${user.username} присоединяется к комнате ${roomId}`);

        // Покидаем предыдущую комнату
        if (socket.roomId) {
            socket.leave(socket.roomId);
            socket.to(socket.roomId).emit('user-left-room', {
                username: user.username,
                avatar: user.avatar
            });
        }

        // Присоединяемся к новой комнате
        socket.roomId = roomId;
        socket.join(roomId);

        // Отправляем историю сообщений
        db.all(`
            SELECT m.*, u.username, u.avatar 
            FROM messages m 
            JOIN users u ON m.user_id = u.id 
            WHERE m.room_id = ? 
            ORDER BY m.created_at DESC 
            LIMIT 100
        `, [roomId], (err, messages) => {
            if (err) {
                console.error('❌ Ошибка загрузки сообщений:', err);
                return;
            }
            socket.emit('message-history', messages.reverse());
        });

        // Уведомляем других пользователей
        socket.to(roomId).emit('user-joined-room', {
            username: user.username,
            avatar: user.avatar
        });

        // Отправляем информацию о комнате (получаем из базы)
        db.get('SELECT * FROM rooms WHERE id = ?', [roomId], (err, room) => {
            if (!err && room) {
                socket.emit('room-info', room);
            }
        });
    });

    // Голосовой чат - присоединение
    socket.on('join-voice', () => {
        const user = activeUsers.get(socket.id);
        if (!user || !socket.roomId) return;

        console.log(`🎤 ${user.username} присоединяется к голосовому чату`);

        voiceUsers.set(socket.id, {
            userId: user.userId,
            username: user.username,
            avatar: user.avatar,
            roomId: socket.roomId,
            socketId: socket.id
        });

        // Уведомляем других в комнате
        socket.to(socket.roomId).emit('user-joined-voice', {
            username: user.username,
            avatar: user.avatar
        });

        // Обновляем список пользователей в голосовом чате
        updateVoiceUsers(socket.roomId);
    });

    // Голосовой чат - выход
    socket.on('leave-voice', () => {
        const user = activeUsers.get(socket.id);
        if (!user || !socket.roomId) return;

        console.log(`🎤 ${user.username} выходит из голосового чата`);

        voiceUsers.delete(socket.id);

        // Уведомляем других в комнате
        socket.to(socket.roomId).emit('user-left-voice', user.username);

        // Обновляем список пользователей в голосовом чате
        updateVoiceUsers(socket.roomId);
    });

    // WebRTC сигналы
    socket.on('webrtc-offer', (data) => {
        console.log('📞 WebRTC offer от:', data.from);
        socket.to(data.to).emit('webrtc-offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('webrtc-answer', (data) => {
        console.log('📞 WebRTC answer от:', data.from);
        socket.to(data.to).emit('webrtc-answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.to).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // Отправка сообщения
    socket.on('send-message', (data) => {
        const user = activeUsers.get(socket.id);
        if (!user || !socket.roomId) return;

        // Сохраняем в базу
        db.run(
            'INSERT INTO messages (room_id, user_id, content) VALUES (?, ?, ?)',
            [socket.roomId, user.userId, data.text],
            function(err) {
                if (err) {
                    console.error('❌ Ошибка сохранения сообщения:', err);
                    return;
                }

                // Отправляем всем в комнате
                io.to(socket.roomId).emit('new-message', {
                    id: this.lastID,
                    room_id: socket.roomId,
                    user_id: user.userId,
                    content: data.text,
                    created_at: new Date(),
                    username: user.username,
                    avatar: user.avatar
                });

                console.log(`💬 ${user.username}: ${data.text}`);
            }
        );
    });

    // Отключение
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            console.log('❌ Пользователь отключился:', user.username);
            
            // Выходим из голосового чата если был
            if (voiceUsers.has(socket.id)) {
                voiceUsers.delete(socket.id);
                if (socket.roomId) {
                    socket.to(socket.roomId).emit('user-left-voice', user.username);
                    updateVoiceUsers(socket.roomId);
                }
            }
            
            // Обновляем статус в базе
            db.run('UPDATE users SET status = ? WHERE id = ?', ['offline', user.userId]);
            
            activeUsers.delete(socket.id);
            
            // Уведомляем о выходе из комнаты
            if (socket.roomId) {
                socket.to(socket.roomId).emit('user-left-room', {
                    username: user.username,
                    avatar: user.avatar
                });
            }
            
            // Обновляем список онлайн пользователей
            updateOnlineUsers();
        }
    });
});

// Запускаем сервер
const PORT = 3000;
server.listen(PORT, () => {
    console.log('===================================');
    console.log('🚀 NEO-CORD SERVER STARTED');
    console.log('===================================');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('✅ Голосовой чат активирован');
    console.log('✅ Отображение онлайн пользователей');
    console.log('===================================');
});