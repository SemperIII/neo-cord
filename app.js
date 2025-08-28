const socket = io();
let currentUser = null;
let currentRoom = null;
let localStream = null;
let peerConnections = new Map();
let isInVoiceChat = false;

// Показываем вкладки
function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if (tabName === 'login') {
        document.querySelector('.tab:nth-child(1)').classList.add('active');
        document.getElementById('loginTab').classList.add('active');
    } else {
        document.querySelector('.tab:nth-child(2)').classList.add('active');
        document.getElementById('registerTab').classList.add('active');
    }
}

// Регистрация
async function register() {
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    const email = document.getElementById('registerEmail').value;

    if (!username || !password) {
        showMessage('Заполните имя и пароль', 'error');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password, email })
        });

        const data = await response.json();

        if (data.success) {
            showMessage('Регистрация успешна! Теперь войдите', 'success');
            showTab('login');
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Ошибка соединения', 'error');
    }
}

// Вход
async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    console.log('🔄 Попытка входа:', username);

    if (!username || !password) {
        showMessage('Заполните имя и пароль', 'error');
        return;
    }

    // Показываем индикатор
    document.getElementById('loading').style.display = 'block';
    document.getElementById('authMessage').style.display = 'none';

    try {
        console.log('📡 Отправляем запрос на сервер...');
        
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        console.log('📨 Ответ получен. Статус:', response.status);

        const data = await response.json();
        console.log('📊 Данные ответа:', data);

        if (response.ok && data.success) {
            console.log('✅ API вход успешен');
            currentUser = data.user;
            
            // Аутентифицируемся через WebSocket
            console.log('🔐 Отправляем аутентификацию WebSocket...');
            socket.emit('authenticate', { userId: currentUser.id });
            
        } else {
            console.log('❌ Ошибка входа:', data.error);
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('❌ Ошибка сети:', error);
        showMessage('Ошибка соединения с сервером', 'error');
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

// Выход
function logout() {
    if (isInVoiceChat) {
        leaveVoiceChat();
    }
    
    currentUser = null;
    socket.disconnect();
    
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    
    // Очищаем поля
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    
    // Переподключаемся
    socket.connect();
}

// Присоединение к комнате
function joinRoom(roomId, roomName) {
    if (!currentUser) return;
    
    socket.emit('join-room', roomId);
    currentRoom = roomId;
    
    // Обновляем интерфейс
    document.querySelectorAll('.room-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const roomElement = document.querySelector(`.room-item[data-id="${roomId}"]`);
    if (roomElement) {
        roomElement.classList.add('active');
    }
    
    document.getElementById('roomTitle').textContent = roomName;
    document.getElementById('messagesContainer').innerHTML = '';
    
    // Загружаем онлайн пользователей для этой комнаты
    loadOnlineUsers();
}

// Загрузка онлайн пользователей
async function loadOnlineUsers() {
    try {
        const response = await fetch('/api/online-users');
        const users = await response.json();
        updateOnlineUsersList(users);
    } catch (error) {
        console.error('Ошибка загрузки онлайн пользователей:', error);
    }
}

// Обновление списка онлайн пользователей
function updateOnlineUsersList(users) {
    const onlineList = document.getElementById('onlineUsersList');
    const onlineCount = document.getElementById('onlineCount');
    
    onlineList.innerHTML = '';
    onlineCount.textContent = users.length;
    
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-online-item';
        
        // Проверяем, находится ли пользователь в голосовом чате
        const isInVoice = Array.from(voiceUsers.values()).some(voiceUser => 
            voiceUser.userId === user.id && voiceUser.roomId === currentRoom
        );
        
        userItem.innerHTML = `
            <img class="user-online-avatar" src="${user.avatar}" alt="${user.username}">
            <span class="user-online-name">${user.username}</span>
            <span class="user-online-status ${isInVoice ? 'voice' : user.status}"></span>
        `;
        onlineList.appendChild(userItem);
    });
}

// Голосовой чат - присоединение
async function joinVoiceChat() {
    try {
        // Запрашиваем доступ к микрофону
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            },
            video: false
        });
        
        console.log('🎤 Доступ к микрофону получен');
        
        // Подключаемся к голосовому чату
        socket.emit('join-voice');
        isInVoiceChat = true;
        
        // Обновляем интерфейс
        document.getElementById('joinVoiceBtn').style.display = 'none';
        document.getElementById('leaveVoiceBtn').style.display = 'block';
        document.getElementById('voiceChatSidebar').style.display = 'flex';
        
        showNotification('🎤 Вы присоединились к голосовому чату', 'success');
        
        // Инициализируем WebRTC соединения с другими пользователями
        initializeVoiceConnections();
        
    } catch (error) {
        console.error('❌ Ошибка доступа к микрофону:', error);
        showNotification('Не удалось получить доступ к микрофону', 'error');
    }
}

// Голосовой чат - выход
function leaveVoiceChat() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Закрываем все peer соединения
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    socket.emit('leave-voice');
    isInVoiceChat = false;
    
    // Обновляем интерфейс
    document.getElementById('joinVoiceBtn').style.display = 'block';
    document.getElementById('leaveVoiceBtn').style.display = 'none';
    document.getElementById('voiceChatSidebar').style.display = 'none';
    
    showNotification('🎤 Вы вышли из голосового чата', 'warning');
}

// Инициализация WebRTC соединений
async function initializeVoiceConnections() {
    // Получаем список пользователей в голосовом чате
    const voiceUsersResponse = await fetch('/api/online-users');
    const voiceUsers = await voiceUsersResponse.json();
    
    // Создаем соединения с каждым пользователем
    voiceUsers.forEach(user => {
        if (user.id !== currentUser.id) {
            createPeerConnection(user.id);
        }
    });
}

// Создание WebRTC соединения
async function createPeerConnection(targetUserId) {
    try {
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        });

        // Добавляем локальный поток
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Обработчик входящих потоков
        peerConnection.ontrack = (event) => {
            console.log('🎧 Получен удаленный аудиопоток');
            const audio = document.createElement('audio');
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            audio.controls = false;
            audio.className = 'remote-audio';
            document.body.appendChild(audio);
        };

        // Генерация ICE кандидатов
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', {
                    to: targetUserId,
                    candidate: event.candidate
                });
            }
        };

        // Создаем предложение
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Отправляем предложение
        socket.emit('webrtc-offer', {
            to: targetUserId,
            offer: offer
        });

        peerConnections.set(targetUserId, peerConnection);
        
    } catch (error) {
        console.error('❌ Ошибка создания WebRTC соединения:', error);
    }
}

// Обработка входящего WebRTC предложения
async function handleWebRTCOffer(offer, fromSocketId, fromUserId) {
    try {
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // Добавляем локальный поток
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Обработчик входящих потоков
        peerConnection.ontrack = (event) => {
            console.log('🎧 Получен удаленный аудиопоток');
            const audio = document.createElement('audio');
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            audio.controls = false;
            audio.className = 'remote-audio';
            document.body.appendChild(audio);
        };

        // Генерация ICE кандидатов
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', {
                    to: fromUserId,
                    candidate: event.candidate
                });
            }
        };

        // Устанавливаем удаленное описание
        await peerConnection.setRemoteDescription(offer);

        // Создаем ответ
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Отправляем ответ
        socket.emit('webrtc-answer', {
            to: fromUserId,
            answer: answer
        });

        peerConnections.set(fromUserId, peerConnection);
        
    } catch (error) {
        console.error('❌ Ошибка обработки WebRTC предложения:', error);
    }
}

// Обработка WebRTC ответа
async function handleWebRTCAnswer(answer, fromSocketId, fromUserId) {
    const peerConnection = peerConnections.get(fromUserId);
    if (peerConnection) {
        await peerConnection.setRemoteDescription(answer);
    }
}

// Обработка ICE кандидата
async function handleICECandidate(candidate, fromSocketId, fromUserId) {
    const peerConnection = peerConnections.get(fromUserId);
    if (peerConnection) {
        await peerConnection.addIceCandidate(candidate);
    }
}

// Переключение видимости голосового чата
function toggleVoiceChat() {
    const voiceChat = document.getElementById('voiceChatSidebar');
    if (voiceChat.style.display === 'flex') {
        voiceChat.style.display = 'none';
    } else {
        voiceChat.style.display = 'flex';
    }
}

// Отправка сообщения
function sendMessage() {
    if (!currentUser || !currentRoom) return;
    
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (text) {
        socket.emit('send-message', { text });
        input.value = '';
    }
}

// Показ сообщений
function showMessage(text, type) {
    const messageDiv = document.getElementById('authMessage');
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.className = 'message';
    }, 3000);
}

// Показ уведомлений
function showNotification(text, type = 'info') {
    const notifications = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = text;
    
    notifications.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Добавление сообщения в чат
function addMessageToChat(message) {
    const container = document.getElementById('messagesContainer');
    
    // Убираем приветственное сообщение если есть
    const welcome = container.querySelector('.welcome-message');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-item';
    
    const time = new Date(message.created_at).toLocaleTimeString();
    const isCurrentUser = currentUser && message.user_id === currentUser.id;
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <img class="message-avatar" src="${message.avatar}" alt="${message.username}">
            <span class="message-user" style="color: ${isCurrentUser ? '#7289da' : '#43b581'}">${message.username}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-text">${message.content}</div>
    `;
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

// Обновление списка пользователей в голосовом чате
function updateVoiceUsersList(users) {
    const voiceUsersContainer = document.getElementById('voiceUsers');
    
    if (users.length === 0) {
        voiceUsersContainer.innerHTML = `
            <div class="no-users">
                <i class="fas fa-microphone-slash"></i>
                <p>Никого нет в голосовом чате</p>
            </div>
        `;
        return;
    }
    
    voiceUsersContainer.innerHTML = '';
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'voice-user-item';
        userItem.innerHTML = `
            <img class="voice-user-avatar" src="${user.avatar}" alt="${user.username}">
            <div class="voice-user-info">
                <div class="voice-user-name">${user.username}</div>
                <div class="voice-user-status">🎤 Говорит</div>
            </div>
        `;
        voiceUsersContainer.appendChild(userItem);
    });
}

// Обработчики Socket.io
socket.on('authenticated', (data) => {
    console.log('✅ WebSocket аутентификация подтверждена', data);
    currentUser = data.user;
    
    // Обновляем интерфейс
    document.getElementById('userName').textContent = currentUser.username;
    document.getElementById('userAvatar').src = currentUser.avatar;
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';
    
    showNotification(`Добро пожаловать, ${currentUser.username}!`, 'success');
    
    // Загружаем онлайн пользователей
    loadOnlineUsers();
});

socket.on('auth-error', (error) => {
    console.error('❌ Ошибка WebSocket аутентификации:', error);
    showNotification('Ошибка аутентификации. Перезагрузите страницу.', 'error');
});

socket.on('rooms-list', (rooms) => {
    console.log('📋 Получены комнаты:', rooms);
    const roomList = document.getElementById('roomList');
    roomList.innerHTML = '';
    
    rooms.forEach(room => {
        const roomItem = document.createElement('li');
        roomItem.className = 'room-item';
        roomItem.dataset.id = room.id;
        roomItem.innerHTML = `
            <i class="fas ${room.type === 'voice' ? 'fa-microphone' : 'fa-hashtag'}"></i>
            ${room.name}
        `;
        roomItem.onclick = () => joinRoom(room.id, room.name);
        roomList.appendChild(roomItem);
    });
});

socket.on('online-users', (users) => {
    console.log('👥 Онлайн пользователи:', users);
    updateOnlineUsersList(users);
});

socket.on('message-history', (messages) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="welcome-message">
                <i class="fas fa-comments"></i>
                <h3>Начните общение в этом канале!</h3>
                <p>Отправьте первое сообщение</p>
            </div>
        `;
        return;
    }
    
    messages.forEach(message => addMessageToChat(message));
});

socket.on('new-message', (message) => {
    addMessageToChat(message);
});

socket.on('user-joined-room', (user) => {
    const container = document.getElementById('messagesContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-item';
    messageDiv.innerHTML = `
        <div class="message-text" style="color: #43b581; text-align: center;">
            <i class="fas fa-user-plus"></i> ${user.username} присоединился к каналу
        </div>
    `;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    
    showNotification(`🟢 ${user.username} присоединился к каналу`, 'success');
    
    // Обновляем список онлайн пользователей
    loadOnlineUsers();
});

socket.on('user-left-room', (user) => {
    const container = document.getElementById('messagesContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-item';
    messageDiv.innerHTML = `
        <div class="message-text" style="color: #f04747; text-align: center;">
            <i class="fas fa-user-times"></i> ${user.username} покинул канал
        </div>
    `;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    
    showNotification(`⚫ ${user.username} покинул канал`, 'error');
    
    // Обновляем список онлайн пользователей
    loadOnlineUsers();
});

// Голосовой чат события
socket.on('user-joined-voice', (user) => {
    showNotification(`🎤 ${user.username} присоединился к голосовому чату`, 'success');
    // Обновляем список онлайн пользователей
    loadOnlineUsers();
});

socket.on('user-left-voice', (username) => {
    showNotification(`🎤 ${username} вышел из голосового чата`, 'warning');
    // Обновляем список онлайн пользователей
    loadOnlineUsers();
});

socket.on('voice-users-update', (users) => {
    console.log('🎤 Пользователи в голосовом чате:', users);
    updateVoiceUsersList(users);
});

// WebRTC события
socket.on('webrtc-offer', async (data) => {
    console.log('📞 Получено WebRTC предложение от:', data.fromUserId);
    await handleWebRTCOffer(data.offer, data.from, data.fromUserId);
});

socket.on('webrtc-answer', async (data) => {
    console.log('📞 Получен WebRTC ответ от:', data.fromUserId);
    await handleWebRTCAnswer(data.answer, data.from, data.fromUserId);
});

socket.on('webrtc-ice-candidate', async (data) => {
    console.log('📞 Получен ICE кандидат от:', data.fromUserId);
    await handleICECandidate(data.candidate, data.from, data.fromUserId);
});

socket.on('connect', () => {
    console.log('✅ WebSocket подключен');
    showNotification('Подключено к серверу', 'success');
});

socket.on('disconnect', () => {
    console.log('❌ WebSocket отключен');
    showNotification('Отключено от сервера', 'error');
});

socket.on('connect_error', (error) => {
    console.error('❌ Ошибка подключения WebSocket:', error);
    document.getElementById('loading').style.display = 'none';
    showNotification('Ошибка подключения к серверу', 'error');
});

// Обработчик клавиши Enter
document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    // Запрос разрешения на уведомления
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // Запрос разрешения на микрофон заранее
    if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                stream.getTracks().forEach(track => track.stop());
            })
            .catch(() => {
                // Ignore error - мы просто предварительно запрашиваем разрешение
            });
    }
});