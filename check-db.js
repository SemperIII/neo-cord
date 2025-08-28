const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'neocord.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Проверяем базу данных...');

// Проверяем пользователей
db.all('SELECT * FROM users', (err, users) => {
    if (err) {
        console.error('❌ Ошибка при чтении пользователей:', err);
        return;
    }
    
    console.log('👥 Пользователи в базе:');
    users.forEach(user => {
        console.log(`   ID: ${user.id}, Name: ${user.username}, Password: ${user.password}`);
    });
    
    // Проверяем комнаты
    db.all('SELECT * FROM rooms', (err, rooms) => {
        console.log('\n📋 Комнаты в базе:');
        rooms.forEach(room => {
            console.log(`   ID: ${room.id}, Name: ${room.name}`);
        });
        
        db.close();
    });
});