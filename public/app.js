const socket = io();

// PeerJS для WebRTC
let peer = null;
const peers = {};

// Настройки детектора голосовой активности
let audioContext = null;
let analyser = null;
let microphone = null;
let speaking = false;
let voiceActivityDetectionInterval = null;
const SPEAKING_THRESHOLD = 0.15; // Увеличили порог
const SILENCE_DURATION = 300; // Миллисекунды тишины перед отключением
let silenceTimer = null;

// Режим отладки голосовой активности
window.DEBUG_VOICE = false;

// Инициализация PeerJS
function initPeer() {
    peer = new Peer({
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 3
    });

    peer.on('open', (id) => {
        console.log('✅ PeerJS подключен. ID:', id);
        socket.emit('peer-id', { peerId: id });
    });

    peer.on('connection', (conn) => {
        console.log('🔗 Peer подключение от:', conn.peer);
    });

    peer.on('call', (call) => {
        console.log('📞 Входящий звонок от:', call.peer);
        
        // Ответим на звонок с нашим потоком
        if (localStream) {
            call.answer(localStream);
        }
        
        call.on('stream', (remoteStream) => {
            console.log('🎧 Получен удаленный поток');
            addAudioStream(remoteStream, call.peer);
        });
    });

    peer.on('error', (err) => {
        console.error('❌ PeerJS ошибка:', err);
    });
}

// Добавление аудиопотока
function addAudioStream(stream, peerId) {
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.className = 'remote-audio';
    audio.id = `audio-${peerId}`;
    document.body.appendChild(audio);
}

// Удаление аудиопотока
function removeAudioStream(peerId) {
    const audio = document.getElementById(`audio-${peerId}`);
    if (audio) {
        audio.remove();
    }
}

// Звонок другому пользователю
function callUser(peerId) {
    if (!localStream || !peer) return;
    
    console.log('📞 Звонок пользователю:', peerId);
    
    const call = peer.call(peerId, localStream);
    
    call.on('stream', (remoteStream) => {
        console.log('🎧 Получен удаленный поток от:', peerId);
        addAudioStream(remoteStream, peerId);
    });
    
    call.on('close', () => {
        console.log('📞 Звонок завершен с:', peerId);
        removeAudioStream(peerId);
    });
}

// Детектор голосовой активности
async function setupVoiceActivityDetection(stream) {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        
        microphone.connect(analyser);
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.8;
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        // Запускаем проверку голосовой активности
        voiceActivityDetectionInterval = setInterval(() => {
            analyser.getByteFrequencyData(dataArray);
            
            // Вычисляем среднюю громкость
            let sum = 0;
            let count = 0;
            
            // Анализируем только средние частоты (голосовые)
            for (let i = 10; i < 100; i++) {
                if (dataArray[i] > 0) {
                    sum += dataArray[i];
                    count++;
                }
            }
            
            const average = count > 0 ? sum / count / 256 : 0;
            
            // Отладочная информация
            if (window.DEBUG_VOICE) {
                console.log('Уровень звука:', average.toFixed(3), 'Порог:', SPEAKING_THRESHOLD);
            }
            
            // Определяем, говорит ли пользователь
            if (average > SPEAKING_THRESHOLD) {
                if (!speaking) {
                    speaking = true;
                    socket.emit('start-speaking');
                    console.log('🎤 Начало речи');
                }
                
                // Сбрасываем таймер тишины
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                    silenceTimer = null;
                }
                
            } else if (speaking) {
                // Запускаем таймер для подтверждения тишины
                if (!silenceTimer) {
                    silenceTimer = setTimeout(() => {
                        speaking = false;
                        socket.emit('stop-speaking');
                        console.log('🎤 Окончание речи');
                        silenceTimer = null;
                    }, SILENCE_DURATION);
                }
            }
            
        }, 50);
        
    } catch (error) {
        console.error('❌ Ошибка детектора голосовой активности:', error);
    }
}

// Остановка детектора голосовой активности
function stopVoiceActivityDetection() {
    if (voiceActivityDetectionInterval) {
        clearInterval(voiceActivityDetectionInterval);
        voiceActivityDetectionInterval = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    speaking = false;
    analyser = null;
    microphone = null;
    
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
}

let currentUser = null;
let currentRoom = null;
let localStream = null;
let isInVoiceChat = false;

// Режим отладки
function toggleDebugMode() {
    window.DEBUG_VOICE = !window.DEBUG_VOICE;
    console.log('Режим отладки голосовой активности:', window.DEBUG_VOICE);
    showNotification(`Режим отладки: ${window.DEBUG_VOICE ? 'ВКЛ' : 'ВЫКЛ'}`, 'info');
}

// Проверка доступности микрофона
async function checkMicrophoneAvailability() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return false;
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        
        console.log('Доступные микрофоны:', audioDevices);
        
        return audioDevices.length > 0;
    } catch (error) {
        console.error('Ошибка проверки микрофонов:', error);
        return false;
    }
}

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
        
        userItem.innerHTML = `
            <img class="user-online-avatar" src="${user.avatar}" alt="${user.username}">
            <span class="user-online-name">${user.username}</span>
            <span class="user-online-status ${user.status}"></span>
        `;
        onlineList.appendChild(userItem);
    });
}

// Голосовой чат - присоединение
async function joinVoiceChat() {
    try {
        // Проверяем доступность микрофона
        const hasMicrophone = await checkMicrophoneAvailability();
        if (!hasMicrophone) {
            throw new Error('Микрофон не найден');
        }

        // Запрашиваем доступ к микрофону с обработкой разных браузеров
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100,
                channelCount: 1
            },
            video: false
        };

        // Пробуем разные варианты настроек для совместимости
        try {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (firstError) {
            console.log('Попытка 1 не удалась, пробуем упрощенные настройки:', firstError);
            
            // Упрощенные настройки для проблемных браузеров
            const simpleConstraints = {
                audio: true,
                video: false
            };
            
            try {
                localStream = await navigator.mediaDevices.getUserMedia(simpleConstraints);
            } catch (secondError) {
                console.log('Попытка 2 не удалась:', secondError);
                throw new Error('Не удалось получить доступ к микрофону. Проверьте разрешения браузера.');
            }
        }
        
        console.log('🎤 Доступ к микрофону получен');

        // Инициализируем детектор голосовой активности
        await setupVoiceActivityDetection(localStream);
        
        // Инициализируем PeerJS
        initPeer();
        
        // Подключаемся к голосовому чату
        socket.emit('join-voice');
        isInVoiceChat = true;
        
        // Обновляем интерфейс
        document.getElementById('joinVoiceBtn').style.display = 'none';
        document.getElementById('leaveVoiceBtn').style.display = 'block';
        document.getElementById('voiceChatSidebar').style.display = 'flex';
        
        showNotification('🎤 Вы присоединились к голосовому чату', 'success');
        
    } catch (error) {
        console.error('❌ Ошибка доступа к микрофону:', error);
        
        let errorMessage = 'Не удалось получить доступ к микрофону';
        
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'Микрофон не найден. Проверьте подключение микрофона.';
        } else if (error.name === 'NotReadableError') {
            errorMessage = 'Микрофон занят другим приложением. Закройте другие программы, использующие микрофон.';
        }
        
        showNotification(errorMessage, 'error');
    }
}

// Голосовой чат - выход
function leaveVoiceChat() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Останавливаем детектор голосовой активности
    stopVoiceActivityDetection();
    
    // Закрываем все peer соединения
    if (peer) {
        peer.destroy();
        peer = null;
    }
    
    // Удаляем все аудио элементы
    document.querySelectorAll('.remote-audio').forEach(audio => audio.remove());
    
    socket.emit('leave-voice');
    isInVoiceChat = false;
    
    // Обновляем интерфейс
    document.getElementById('joinVoiceBtn').style.display = 'block';
    document.getElementById('leaveVoiceBtn').style.display = 'none';
    document.getElementById('voiceChatSidebar').style.display = 'none';
    
    showNotification('🎤 Вы вышли из голосового чата', 'warning');
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
                <div class="voice-user-status">🎤 В голосовом чате</div>
            </div>
        `;
        voiceUsersContainer.appendChild(userItem);
    });
}

// Обновление списка говорящих пользователей
function updateSpeakingUsersList(users) {
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
                <div class="voice-user-status speaking">🎤 Говорит</div>
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
            <div class='welcome-message'>
                <i class='fas fa-comments'></i>
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

socket.on('speaking-users-update', (users) => {
    console.log('🎤 Говорящие пользователи:', users);
    updateSpeakingUsersList(users);
});

// WebRTC события
socket.on('user-peer-id', (data) => {
    console.log('👤 Пользователь подключился с PeerID:', data.peerId);
    if (isInVoiceChat && data.userId !== currentUser.id) {
        callUser(data.peerId);
    }
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
document.addEventListener('DOMContentLoaded', async () => {
    // Запрос разрешения на уведомления
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // Проверяем микрофоны
    const hasMicrophone = await checkMicrophoneAvailability();
    if (!hasMicrophone) {
        const joinBtn = document.getElementById('joinVoiceBtn');
        if (joinBtn) {
            joinBtn.disabled = true;
            joinBtn.innerHTML = '<i class="fas fa-microphone-slash"></i> Микрофон не найден';
        }
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