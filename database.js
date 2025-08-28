// Простая база данных в памяти с улучшениями
class MemoryDB {
    constructor() {
        this.users = new Map();
        this.rooms = [
            { id: 1, name: 'general', created_at: new Date(), type: 'text' },
            { id: 2, name: 'random', created_at: new Date(), type: 'text' },
            { id: 3, name: 'voice-chat', created_at: new Date(), type: 'voice' }
        ];
        this.messages = new Map();
        this.nextUserId = 1;
        this.nextMessageId = 1;
        this.userStatus = new Map();
    }
    
    createUser(username, password) {
        const user = {
            id: this.nextUserId++,
            username,
            password,
            created_at: new Date(),
            avatar: this.generateAvatar(username),
            status: 'online'
        };
        this.users.set(user.id, user);
        this.userStatus.set(user.id, 'online');
        return user;
    }
    
    generateAvatar(username) {
        const colors = ['#7289da', '#43b581', '#faa61a', '#f04747', '#747f8d'];
        const color = colors[username.length % colors.length];
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=${color.slice(1)}&color=fff&size=128`;
    }
    
    getUserByUsername(username) {
        return Array.from(this.users.values()).find(u => u.username === username);
    }
    
    getUserById(id) {
        return this.users.get(Number(id));
    }
    
    getRooms() {
        return this.rooms;
    }
    
    createMessage(roomId, userId, text) {
        const user = this.getUserById(userId);
        if (!user) {
            console.error('User not found for message creation:', userId);
            return null;
        }

        const message = {
            id: this.nextMessageId++,
            room_id: roomId,
            user_id: userId,
            text,
            created_at: new Date(),
            username: user.username,
            avatar: user.avatar,
            likes: 0,
            likedBy: []
        };
        
        if (!this.messages.has(roomId)) {
            this.messages.set(roomId, []);
        }
        this.messages.get(roomId).push(message);
        return message;
    }
    
    getMessages(roomId, limit = 100) {
        if (!this.messages.has(roomId)) {
            return [];
        }
        return this.messages.get(roomId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit)
            .reverse();
    }
    
    likeMessage(messageId, userId) {
        for (const roomMessages of this.messages.values()) {
            const message = roomMessages.find(m => m.id === messageId);
            if (message) {
                if (!message.likedBy.includes(userId)) {
                    message.likes++;
                    message.likedBy.push(userId);
                }
                return message;
            }
        }
        return null;
    }
    
    setUserStatus(userId, status) {
        this.userStatus.set(userId, status);
        const user = this.getUserById(userId);
        if (user) {
            user.status = status;
        }
    }
    
    getOnlineUsers() {
        return Array.from(this.users.values()).filter(user => 
            this.userStatus.get(user.id) === 'online'
        );
    }
}

module.exports = new MemoryDB();