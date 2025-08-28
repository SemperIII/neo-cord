const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'neocord.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT,
        email TEXT,
        status TEXT DEFAULT 'online',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица комнат
    db.run(`CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        type TEXT DEFAULT 'text',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица сообщений
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER,
        user_id INTEGER,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'text',
        likes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Создаем стандартные комнаты
    const defaultRooms = [
        ['general', 'text', 'Основной чат для общения'],
        ['random', 'text', 'Свободное общение на любые темы'],
        ['help', 'text', 'Помощь и поддержка'],
        ['voice-chat', 'voice', 'Голосовой чат']
    ];

    const insertRoom = db.prepare('INSERT OR IGNORE INTO rooms (name, type, description) VALUES (?, ?, ?)');
    defaultRooms.forEach(room => {
        insertRoom.run(room);
    });
    insertRoom.finalize();

    console.log('✅ База данных создана!');
    console.log('📋 Комнаты: general, random, help, voice-chat');
});

db.close();