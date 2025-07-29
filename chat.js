/**
 * 聊天功能模块
 * 支持公开/私密对话、多人聊天、消息加密
 */

class ChatManager {
    constructor(ultrasonicComm) {
        this.ultrasonicComm = ultrasonicComm;
        this.currentRoom = null;
        this.rooms = new Map(); // 聊天室管理
        this.isPrivateMode = false;
        this.encryptionKey = null;
        
        // 消息历史
        this.messageHistory = [];
        this.maxHistorySize = 100;
        
        // 用户管理
        this.connectedUsers = new Map();
        this.myUserId = ultrasonicComm.myUserId;
        this.myUsername = ultrasonicComm.getUsername();
        
        // 回调函数
        this.onMessageReceived = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onRoomStateChanged = null;
        this.onInviteReceived = null;
        
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        // 监听超声波通信事件
        this.ultrasonicComm.onDataReceived = (data) => {
            this.handleIncomingData(data);
        };
        
        this.ultrasonicComm.onUserDetected = (userId, userData) => {
            this.handleUserDetected(userId, userData);
        };
    }
    
    // 处理传入数据
    handleIncomingData(data) {
        switch (data.type) {
            case 'chat':
                this.handleChatMessage(data);
                break;
            case 'invite':
                this.handleInvite(data);
                break;
            case 'join_room':
                this.handleJoinRoom(data);
                break;
            case 'leave_room':
                this.handleLeaveRoom(data);
                break;
            case 'room_update':
                this.handleRoomUpdate(data);
                break;
            case 'private_key':
                this.handlePrivateKey(data);
                break;
        }
    }
    
    // 处理用户发现
    handleUserDetected(userId, userData) {
        if (!this.connectedUsers.has(userId)) {
            this.connectedUsers.set(userId, {
                userId,
                username: userData.username,
                lastSeen: Date.now(),
                isOnline: true
            });
            
            if (this.onUserJoined) {
                this.onUserJoined(userId, userData);
            }
        } else {
            // 更新用户信息
            const user = this.connectedUsers.get(userId);
            user.lastSeen = Date.now();
            user.isOnline = true;
        }
    }
    
    // 创建或加入聊天室
    async createOrJoinRoom(roomId = null, isPrivate = false) {
        if (!roomId) {
            roomId = this.generateRoomId();
        }
        
        const room = {
            id: roomId,
            name: `聊天室 ${roomId.substr(0, 4)}`,
            isPrivate: isPrivate,
            members: new Set([this.myUserId]),
            createdBy: this.myUserId,
            createdAt: Date.now(),
            encryptionKey: isPrivate ? this.generateEncryptionKey() : null
        };
        
        this.rooms.set(roomId, room);
        this.currentRoom = room;
        this.isPrivateMode = isPrivate;
        
        if (isPrivate) {
            this.encryptionKey = room.encryptionKey;
        }
        
        // 广播房间创建信息（如果是公开房间）
        if (!isPrivate) {
            await this.broadcastRoomUpdate();
        }
        
        if (this.onRoomStateChanged) {
            this.onRoomStateChanged(room);
        }
        
        console.log('创建/加入聊天室:', roomId, isPrivate ? '私密' : '公开');
        return room;
    }
    
    // 邀请用户到聊天室
    async inviteUser(userId, roomId = null) {
        const targetRoomId = roomId || this.currentRoom?.id;
        if (!targetRoomId) {
            throw new Error('没有活动的聊天室');
        }
        
        const room = this.rooms.get(targetRoomId);
        if (!room) {
            throw new Error('聊天室不存在');
        }
        
        const invite = {
            type: 'invite',
            fromUserId: this.myUserId,
            fromUsername: this.myUsername,
            toUserId: userId,
            roomId: targetRoomId,
            roomName: room.name,
            isPrivate: room.isPrivate,
            timestamp: Date.now()
        };
        
        // 如果是私密房间，包含加密密钥
        if (room.isPrivate) {
            invite.encryptionKey = room.encryptionKey;
        }
        
        await this.ultrasonicComm.transmitData(invite);
        console.log('发送邀请给用户:', userId);
    }
    
    // 处理邀请
    handleInvite(data) {
        if (data.toUserId === this.myUserId) {
            if (this.onInviteReceived) {
                this.onInviteReceived(data);
            }
        }
    }
    
    // 接受邀请
    async acceptInvite(inviteData) {
        const room = {
            id: inviteData.roomId,
            name: inviteData.roomName,
            isPrivate: inviteData.isPrivate,
            members: new Set([this.myUserId]),
            createdBy: inviteData.fromUserId,
            createdAt: Date.now(),
            encryptionKey: inviteData.encryptionKey
        };
        
        this.rooms.set(room.id, room);
        this.currentRoom = room;
        this.isPrivateMode = room.isPrivate;
        
        if (room.isPrivate) {
            this.encryptionKey = room.encryptionKey;
        }
        
        // 通知房间成员有新用户加入
        await this.ultrasonicComm.transmitData({
            type: 'join_room',
            userId: this.myUserId,
            username: this.myUsername,
            roomId: room.id,
            timestamp: Date.now()
        });
        
        if (this.onRoomStateChanged) {
            this.onRoomStateChanged(room);
        }
        
        console.log('接受邀请，加入聊天室:', room.id);
    }
    
    // 处理用户加入房间
    handleJoinRoom(data) {
        const room = this.rooms.get(data.roomId);
        if (room && this.currentRoom?.id === data.roomId) {
            room.members.add(data.userId);
            
            // 更新连接用户信息
            this.connectedUsers.set(data.userId, {
                userId: data.userId,
                username: data.username,
                lastSeen: Date.now(),
                isOnline: true
            });
            
            if (this.onUserJoined) {
                this.onUserJoined(data.userId, data);
            }
            
            // 添加系统消息
            this.addSystemMessage(`${data.username} 加入了聊天室`);
        }
    }
    
    // 处理用户离开房间
    handleLeaveRoom(data) {
        const room = this.rooms.get(data.roomId);
        if (room && this.currentRoom?.id === data.roomId) {
            room.members.delete(data.userId);
            
            if (this.onUserLeft) {
                this.onUserLeft(data.userId, data);
            }
            
            // 添加系统消息
            const user = this.connectedUsers.get(data.userId);
            const username = user?.username || data.username || '用户';
            this.addSystemMessage(`${username} 离开了聊天室`);
        }
    }
    
    // 发送消息
    async sendMessage(content, type = 'text') {
        if (!this.currentRoom) {
            throw new Error('没有活动的聊天室');
        }
        
        let messageContent = content;
        
        // 如果是私密模式，加密消息
        if (this.isPrivateMode && this.encryptionKey) {
            messageContent = this.encryptMessage(content, this.encryptionKey);
        }
        
        const message = {
            type: 'chat',
            messageId: this.generateMessageId(),
            roomId: this.currentRoom.id,
            fromUserId: this.myUserId,
            fromUsername: this.myUsername,
            content: messageContent,
            messageType: type,
            isEncrypted: this.isPrivateMode,
            timestamp: Date.now()
        };
        
        // 添加到本地消息历史
        this.addMessage({
            ...message,
            content: content, // 本地存储明文
            isOwn: true
        });
        
        // 发送消息
        await this.ultrasonicComm.transmitData(message);
        
        console.log('发送消息:', content);
        return message;
    }
    
    // 处理聊天消息
    handleChatMessage(data) {
        // 检查是否属于当前房间
        if (!this.currentRoom || data.roomId !== this.currentRoom.id) {
            return;
        }
        
        // 忽略自己发送的消息
        if (data.fromUserId === this.myUserId) {
            return;
        }
        
        let content = data.content;
        
        // 如果消息被加密，尝试解密
        if (data.isEncrypted && this.encryptionKey) {
            try {
                content = this.decryptMessage(data.content, this.encryptionKey);
            } catch (error) {
                console.error('消息解密失败:', error);
                content = '[加密消息 - 解密失败]';
            }
        } else if (data.isEncrypted && !this.encryptionKey) {
            content = '[加密消息 - 无解密密钥]';
        }
        
        const message = {
            ...data,
            content: content,
            isOwn: false
        };
        
        this.addMessage(message);
        
        if (this.onMessageReceived) {
            this.onMessageReceived(message);
        }
    }
    
    // 添加消息到历史
    addMessage(message) {
        this.messageHistory.push(message);
        
        // 限制历史消息数量
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
        }
    }
    
    // 添加系统消息
    addSystemMessage(content) {
        const message = {
            messageId: this.generateMessageId(),
            type: 'system',
            content: content,
            timestamp: Date.now(),
            isOwn: false,
            isSystem: true
        };
        
        this.addMessage(message);
        
        if (this.onMessageReceived) {
            this.onMessageReceived(message);
        }
    }
    
    // 切换隐私模式
    async togglePrivacyMode() {
        if (!this.currentRoom) {
            return false;
        }
        
        this.isPrivateMode = !this.isPrivateMode;
        this.currentRoom.isPrivate = this.isPrivateMode;
        
        if (this.isPrivateMode) {
            // 生成新的加密密钥
            this.encryptionKey = this.generateEncryptionKey();
            this.currentRoom.encryptionKey = this.encryptionKey;
            
            // 向房间成员分发密钥
            await this.distributeEncryptionKey();
            
            this.addSystemMessage('聊天室已切换为私密模式');
        } else {
            this.encryptionKey = null;
            this.currentRoom.encryptionKey = null;
            this.addSystemMessage('聊天室已切换为公开模式');
        }
        
        if (this.onRoomStateChanged) {
            this.onRoomStateChanged(this.currentRoom);
        }
        
        return this.isPrivateMode;
    }
    
    // 分发加密密钥
    async distributeEncryptionKey() {
        if (!this.currentRoom || !this.encryptionKey) return;
        
        const keyData = {
            type: 'private_key',
            roomId: this.currentRoom.id,
            encryptionKey: this.encryptionKey,
            fromUserId: this.myUserId,
            timestamp: Date.now()
        };
        
        await this.ultrasonicComm.transmitData(keyData);
    }
    
    // 处理私钥分发
    handlePrivateKey(data) {
        if (data.roomId === this.currentRoom?.id) {
            this.encryptionKey = data.encryptionKey;
            this.isPrivateMode = true;
            this.currentRoom.isPrivate = true;
            this.currentRoom.encryptionKey = data.encryptionKey;
            
            this.addSystemMessage('收到加密密钥，聊天室已切换为私密模式');
            
            if (this.onRoomStateChanged) {
                this.onRoomStateChanged(this.currentRoom);
            }
        }
    }
    
    // 离开当前房间
    async leaveRoom() {
        if (!this.currentRoom) return;
        
        // 通知其他成员
        await this.ultrasonicComm.transmitData({
            type: 'leave_room',
            userId: this.myUserId,
            username: this.myUsername,
            roomId: this.currentRoom.id,
            timestamp: Date.now()
        });
        
        this.currentRoom = null;
        this.isPrivateMode = false;
        this.encryptionKey = null;
        
        if (this.onRoomStateChanged) {
            this.onRoomStateChanged(null);
        }
    }
    
    // 广播房间更新
    async broadcastRoomUpdate() {
        if (!this.currentRoom || this.currentRoom.isPrivate) return;
        
        const roomUpdate = {
            type: 'room_update',
            roomId: this.currentRoom.id,
            roomName: this.currentRoom.name,
            memberCount: this.currentRoom.members.size,
            isPrivate: this.currentRoom.isPrivate,
            createdBy: this.currentRoom.createdBy,
            timestamp: Date.now()
        };
        
        await this.ultrasonicComm.transmitData(roomUpdate);
    }
    
    // 处理房间更新
    handleRoomUpdate(data) {
        // 如果房间不存在且是公开房间，可以加入
        if (!this.rooms.has(data.roomId) && !data.isPrivate) {
            const room = {
                id: data.roomId,
                name: data.roomName,
                isPrivate: data.isPrivate,
                members: new Set(),
                createdBy: data.createdBy,
                createdAt: data.timestamp,
                encryptionKey: null
            };
            
            this.rooms.set(room.id, room);
            console.log('发现公开聊天室:', room.name);
        }
    }
    
    // 简单的消息加密/解密（使用XOR）
    encryptMessage(message, key) {
        const messageBytes = new TextEncoder().encode(message);
        const keyBytes = new TextEncoder().encode(key);
        const encrypted = new Uint8Array(messageBytes.length);
        
        for (let i = 0; i < messageBytes.length; i++) {
            encrypted[i] = messageBytes[i] ^ keyBytes[i % keyBytes.length];
        }
        
        return Array.from(encrypted).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    decryptMessage(encryptedHex, key) {
        const encrypted = new Uint8Array(encryptedHex.match(/.{2}/g).map(h => parseInt(h, 16)));
        const keyBytes = new TextEncoder().encode(key);
        const decrypted = new Uint8Array(encrypted.length);
        
        for (let i = 0; i < encrypted.length; i++) {
            decrypted[i] = encrypted[i] ^ keyBytes[i % keyBytes.length];
        }
        
        return new TextDecoder().decode(decrypted);
    }
    
    // 工具函数
    generateRoomId() {
        return Math.random().toString(36).substr(2, 8);
    }
    
    generateMessageId() {
        return Math.random().toString(36).substr(2, 12);
    }
    
    generateEncryptionKey() {
        return Math.random().toString(36).substr(2, 16);
    }
    
    // 获取消息历史
    getMessageHistory() {
        return this.messageHistory;
    }
    
    // 获取当前房间信息
    getCurrentRoom() {
        return this.currentRoom;
    }
    
    // 获取连接的用户
    getConnectedUsers() {
        return Array.from(this.connectedUsers.values());
    }
    
    // 清理离线用户
    cleanupOfflineUsers() {
        const now = Date.now();
        const timeout = 30000; // 30秒超时
        
        for (const [userId, user] of this.connectedUsers.entries()) {
            if (now - user.lastSeen > timeout) {
                user.isOnline = false;
                
                if (this.onUserLeft) {
                    this.onUserLeft(userId, user);
                }
            }
        }
    }
    
    // 清除消息历史
    clearHistory() {
        this.messageHistory = [];
    }
    
    // 销毁
    destroy() {
        this.leaveRoom();
        this.rooms.clear();
        this.connectedUsers.clear();
        this.messageHistory = [];
    }
}

// 导出
window.ChatManager = ChatManager; 