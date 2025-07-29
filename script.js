/**
 * 主应用脚本
 * 整合超声波通信和聊天功能
 */

class ChaosChatApp {
    constructor() {
        this.ultrasonicComm = null;
        this.chatManager = null;
        this.isInitialized = false;
        this.currentView = 'radar'; // 'radar' or 'chat'
        
        // UI元素
        this.elements = {};
        this.discoveredUserElements = new Map();
        
        // 状态
        this.isUserInteracted = false;
        this.pendingInvite = null;
        
        this.init();
    }
    
    async init() {
        this.initializeElements();
        this.setupEventListeners();
        await this.initializeModules();
        this.loadSettings();
        
        // 等待用户交互以启动音频
        this.showToast('点击任意位置以启动超声波功能');
    }
    
    initializeElements() {
        // 状态相关
        this.elements.statusText = document.getElementById('statusText');
        this.elements.statusIndicator = document.querySelector('.indicator-dot');
        this.elements.userCount = document.getElementById('userCount');
        
        // 雷达界面
        this.elements.radarView = document.getElementById('radarView');
        this.elements.radarCircle = document.querySelector('.radar-circle');
        
        // 聊天界面
        this.elements.chatView = document.getElementById('chatView');
        this.elements.chatTitle = document.getElementById('chatTitle');
        this.elements.chatType = document.getElementById('chatType');
        this.elements.messagesContainer = document.getElementById('messagesContainer');
        this.elements.messageInput = document.getElementById('messageInput');
        this.elements.sendBtn = document.getElementById('sendBtn');
        this.elements.backBtn = document.getElementById('backBtn');
        this.elements.privacyToggle = document.getElementById('privacyToggle');
        this.elements.inviteBtn = document.getElementById('inviteBtn');
        
        // 设置面板
        this.elements.settingsBtn = document.getElementById('settingsBtn');
        this.elements.settingsPanel = document.getElementById('settingsPanel');
        this.elements.closeSettings = document.getElementById('closeSettings');
        this.elements.usernameInput = document.getElementById('usernameInput');
        this.elements.frequencySelect = document.getElementById('frequencySelect');
        this.elements.volumeSlider = document.getElementById('volumeSlider');
        this.elements.volumeValue = document.getElementById('volumeValue');
        this.elements.autoDiscovery = document.getElementById('autoDiscovery');
        
        // 模态框
        this.elements.connectionModal = document.getElementById('connectionModal');
        this.elements.connectionMessage = document.getElementById('connectionMessage');
        this.elements.acceptBtn = document.getElementById('acceptBtn');
        this.elements.rejectBtn = document.getElementById('rejectBtn');
        
        // Toast
        this.elements.toast = document.getElementById('toast');
        this.elements.toastMessage = document.getElementById('toastMessage');
    }
    
    setupEventListeners() {
        // 用户交互检测
        document.addEventListener('click', this.handleFirstUserInteraction.bind(this), { once: true });
        document.addEventListener('touchstart', this.handleFirstUserInteraction.bind(this), { once: true });
        
        // 聊天相关
        this.elements.sendBtn.addEventListener('click', this.sendMessage.bind(this));
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        this.elements.backBtn.addEventListener('click', this.showRadarView.bind(this));
        this.elements.privacyToggle.addEventListener('click', this.togglePrivacy.bind(this));
        this.elements.inviteBtn.addEventListener('click', this.showInviteOptions.bind(this));
        
        // 设置相关
        this.elements.settingsBtn.addEventListener('click', this.showSettings.bind(this));
        this.elements.closeSettings.addEventListener('click', this.hideSettings.bind(this));
        
        this.elements.usernameInput.addEventListener('change', this.saveUsername.bind(this));
        this.elements.frequencySelect.addEventListener('change', this.changeFrequency.bind(this));
        this.elements.volumeSlider.addEventListener('input', this.changeVolume.bind(this));
        this.elements.autoDiscovery.addEventListener('change', this.toggleAutoDiscovery.bind(this));
        
        // 连接请求处理
        this.elements.acceptBtn.addEventListener('click', this.acceptInvite.bind(this));
        this.elements.rejectBtn.addEventListener('click', this.rejectInvite.bind(this));
        
        // 模态框点击外部关闭
        this.elements.connectionModal.addEventListener('click', (e) => {
            if (e.target === this.elements.connectionModal) {
                this.rejectInvite();
            }
        });
        
        // 设置面板点击外部关闭
        this.elements.settingsPanel.addEventListener('click', (e) => {
            if (e.target === this.elements.settingsPanel) {
                this.hideSettings();
            }
        });
    }
    
    async initializeModules() {
        try {
            // 初始化超声波通信
            this.ultrasonicComm = new UltrasonicComm();
            
            // 设置回调
            this.ultrasonicComm.onStatusChange = this.updateStatus.bind(this);
            this.ultrasonicComm.onUserDetected = this.handleUserDetected.bind(this);
            
            // 初始化聊天管理器
            this.chatManager = new ChatManager(this.ultrasonicComm);
            
            // 设置聊天回调
            this.chatManager.onMessageReceived = this.handleMessageReceived.bind(this);
            this.chatManager.onUserJoined = this.handleUserJoined.bind(this);
            this.chatManager.onUserLeft = this.handleUserLeft.bind(this);
            this.chatManager.onRoomStateChanged = this.handleRoomStateChanged.bind(this);
            this.chatManager.onInviteReceived = this.handleInviteReceived.bind(this);
            
            this.isInitialized = true;
            console.log('应用初始化完成');
            
        } catch (error) {
            console.error('模块初始化失败:', error);
            this.showToast('初始化失败: ' + error.message);
        }
    }
    
    async handleFirstUserInteraction() {
        if (this.isUserInteracted) return;
        
        this.isUserInteracted = true;
        console.log('检测到用户交互，启动超声波功能');
        
        try {
            // 启动超声波发现
            if (this.ultrasonicComm && this.elements.autoDiscovery.checked) {
                this.ultrasonicComm.startDiscovery();
                this.showToast('超声波探测已启动');
            }
        } catch (error) {
            console.error('启动失败:', error);
            this.showToast('启动失败: ' + error.message);
        }
    }
    
    // 状态更新
    updateStatus(status, message) {
        this.elements.statusText.textContent = message;
        
        // 更新状态指示器
        this.elements.statusIndicator.className = 'indicator-dot';
        switch (status) {
            case 'ready':
            case 'receiving':
                this.elements.statusIndicator.classList.add('active');
                break;
            case 'transmitting':
                this.elements.statusIndicator.classList.add('warning');
                break;
            case 'error':
                this.elements.statusIndicator.classList.add('error');
                break;
        }
    }
    
    // 用户发现处理
    handleUserDetected(userId, userData) {
        console.log('发现用户:', userData.username);
        
        // 更新用户计数
        const userCount = this.ultrasonicComm.getDiscoveredUsers().length;
        this.elements.userCount.textContent = userCount;
        
        // 在雷达上显示用户
        this.addUserToRadar(userId, userData);
    }
    
    // 在雷达上添加用户
    addUserToRadar(userId, userData) {
        if (this.discoveredUserElements.has(userId)) {
            return; // 用户已存在
        }
        
        const userElement = document.createElement('div');
        userElement.className = 'detected-user';
        userElement.textContent = userData.username.charAt(0).toUpperCase();
        userElement.title = userData.username;
        userElement.dataset.userId = userId;
        
        // 随机位置（在圆圈周围）
        const angle = Math.random() * 2 * Math.PI;
        const radius = 110; // 稍微超出雷达圆圈
        const x = 50 + (radius / 150) * 50 * Math.cos(angle); // 转换为百分比
        const y = 50 + (radius / 150) * 50 * Math.sin(angle);
        
        userElement.style.left = `${x}%`;
        userElement.style.top = `${y}%`;
        userElement.style.transform = 'translate(-50%, -50%)';
        
        // 点击事件
        userElement.addEventListener('click', () => {
            this.inviteUser(userId, userData);
        });
        
        this.elements.radarCircle.appendChild(userElement);
        this.discoveredUserElements.set(userId, userElement);
    }
    
    // 邀请用户
    async inviteUser(userId, userData) {
        try {
            // 如果没有活动聊天室，创建一个
            if (!this.chatManager.getCurrentRoom()) {
                await this.chatManager.createOrJoinRoom();
            }
            
            await this.chatManager.inviteUser(userId);
            this.showToast(`已邀请 ${userData.username || '用户'} 加入聊天`);
        } catch (error) {
            console.error('邀请失败:', error);
            this.showToast('邀请失败: ' + error.message);
        }
    }
    
    // 处理邀请接收
    handleInviteReceived(inviteData) {
        this.pendingInvite = inviteData;
        this.elements.connectionMessage.textContent = 
            `${inviteData.fromUsername} 邀请您加入 ${inviteData.roomName}`;
        this.showModal(this.elements.connectionModal);
    }
    
    // 接受邀请
    async acceptInvite() {
        if (!this.pendingInvite) return;
        
        try {
            await this.chatManager.acceptInvite(this.pendingInvite);
            this.hideModal(this.elements.connectionModal);
            this.showChatView();
            this.showToast('已加入聊天室');
        } catch (error) {
            console.error('接受邀请失败:', error);
            this.showToast('加入失败: ' + error.message);
        }
        
        this.pendingInvite = null;
    }
    
    // 拒绝邀请
    rejectInvite() {
        this.pendingInvite = null;
        this.hideModal(this.elements.connectionModal);
        this.showToast('已拒绝邀请');
    }
    
    // 显示聊天界面
    showChatView() {
        this.currentView = 'chat';
        this.elements.radarView.classList.add('hidden');
        this.elements.chatView.classList.remove('hidden');
        
        // 聚焦输入框
        setTimeout(() => {
            this.elements.messageInput.focus();
        }, 100);
        
        // 滚动到底部
        this.scrollToBottom();
    }
    
    // 显示雷达界面
    showRadarView() {
        this.currentView = 'radar';
        this.elements.chatView.classList.add('hidden');
        this.elements.radarView.classList.remove('hidden');
        
        // 离开聊天室
        if (this.chatManager) {
            this.chatManager.leaveRoom();
        }
    }
    
    // 发送消息
    async sendMessage() {
        const content = this.elements.messageInput.value.trim();
        if (!content) return;
        
        try {
            this.elements.sendBtn.disabled = true;
            await this.chatManager.sendMessage(content);
            this.elements.messageInput.value = '';
            this.scrollToBottom();
        } catch (error) {
            console.error('发送消息失败:', error);
            this.showToast('发送失败: ' + error.message);
        } finally {
            this.elements.sendBtn.disabled = false;
        }
    }
    
    // 处理消息接收
    handleMessageReceived(message) {
        this.addMessageToUI(message);
        this.scrollToBottom();
    }
    
    // 添加消息到UI
    addMessageToUI(message) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.isOwn ? 'own' : 'other'}`;
        
        if (message.isSystem) {
            messageElement.className += ' system';
            messageElement.style.background = '#f5f5f5';
            messageElement.style.color = '#666';
            messageElement.style.textAlign = 'center';
            messageElement.style.alignSelf = 'center';
            messageElement.style.fontStyle = 'italic';
        }
        
        let html = '';
        
        if (!message.isOwn && !message.isSystem) {
            html += `<div class="message-sender">${message.fromUsername || '未知用户'}</div>`;
        }
        
        html += `<div class="message-content">${this.escapeHtml(message.content)}</div>`;
        html += `<div class="message-time">${this.formatTime(message.timestamp)}</div>`;
        
        messageElement.innerHTML = html;
        this.elements.messagesContainer.appendChild(messageElement);
        
        // 限制消息数量
        const messages = this.elements.messagesContainer.children;
        if (messages.length > 50) {
            messages[0].remove();
        }
    }
    
    // 处理用户加入
    handleUserJoined(userId, userData) {
        console.log('用户加入聊天:', userData.username);
    }
    
    // 处理用户离开
    handleUserLeft(userId, userData) {
        console.log('用户离开聊天:', userData.username);
    }
    
    // 处理房间状态变化
    handleRoomStateChanged(room) {
        if (room) {
            this.elements.chatTitle.textContent = room.name;
            this.elements.chatType.textContent = room.isPrivate ? '私密' : '公开';
            this.elements.privacyToggle.textContent = room.isPrivate ? '🔒' : '🔓';
        } else {
            // 房间已关闭，返回雷达界面
            this.showRadarView();
        }
    }
    
    // 切换隐私模式
    async togglePrivacy() {
        try {
            const isPrivate = await this.chatManager.togglePrivacyMode();
            this.showToast(isPrivate ? '已切换为私密模式' : '已切换为公开模式');
        } catch (error) {
            console.error('切换隐私模式失败:', error);
            this.showToast('切换失败: ' + error.message);
        }
    }
    
    // 显示邀请选项
    showInviteOptions() {
        const users = this.ultrasonicComm.getDiscoveredUsers();
        if (users.length === 0) {
            this.showToast('没有发现其他用户');
            return;
        }
        
        // 创建用户选择界面（简化版本）
        const userNames = users.map(u => u.username).join(', ');
        this.showToast(`可邀请用户: ${userNames}`);
    }
    
    // 设置相关
    showSettings() {
        this.elements.settingsPanel.classList.add('active');
    }
    
    hideSettings() {
        this.elements.settingsPanel.classList.remove('active');
    }
    
    saveUsername() {
        const username = this.elements.usernameInput.value.trim();
        if (username) {
            localStorage.setItem('username', username);
            this.showToast('用户名已保存');
        }
    }
    
    changeFrequency() {
        const mode = this.elements.frequencySelect.value;
        if (this.ultrasonicComm) {
            this.ultrasonicComm.setMode(mode);
            this.showToast(`已切换到${mode === 'high' ? '高频' : '低频'}模式`);
        }
    }
    
    changeVolume() {
        const volume = this.elements.volumeSlider.value;
        this.elements.volumeValue.textContent = `${volume}%`;
        
        if (this.ultrasonicComm) {
            this.ultrasonicComm.setVolume(volume);
        }
    }
    
    toggleAutoDiscovery() {
        const enabled = this.elements.autoDiscovery.checked;
        localStorage.setItem('autoDiscovery', enabled);
        
        if (this.ultrasonicComm && this.isUserInteracted) {
            if (enabled) {
                this.ultrasonicComm.startDiscovery();
                this.showToast('自动发现已启用');
            } else {
                this.ultrasonicComm.stopDiscovery();
                this.showToast('自动发现已禁用');
            }
        }
    }
    
    // 加载设置
    loadSettings() {
        const username = localStorage.getItem('username');
        if (username) {
            this.elements.usernameInput.value = username;
        }
        
        const autoDiscovery = localStorage.getItem('autoDiscovery');
        if (autoDiscovery !== null) {
            this.elements.autoDiscovery.checked = autoDiscovery === 'true';
        }
    }
    
    // UI工具函数
    showModal(modal) {
        modal.classList.remove('hidden');
    }
    
    hideModal(modal) {
        modal.classList.add('hidden');
    }
    
    showToast(message) {
        this.elements.toastMessage.textContent = message;
        this.elements.toast.classList.remove('hidden');
        
        setTimeout(() => {
            this.elements.toast.classList.add('hidden');
        }, 3000);
    }
    
    scrollToBottom() {
        setTimeout(() => {
            this.elements.messagesContainer.scrollTop = 
                this.elements.messagesContainer.scrollHeight;
        }, 100);
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // 清理过期用户
    cleanupExpiredUsers() {
        const now = Date.now();
        const timeout = 15000; // 15秒超时
        
        for (const [userId, element] of this.discoveredUserElements.entries()) {
            const users = this.ultrasonicComm.getDiscoveredUsers();
            const user = users.find(u => u.userId === userId);
            
            if (!user || now - user.lastSeen > timeout) {
                element.remove();
                this.discoveredUserElements.delete(userId);
            }
        }
        
        // 更新用户计数
        const userCount = this.ultrasonicComm.getDiscoveredUsers().length;
        this.elements.userCount.textContent = userCount;
    }
    
    // 定期清理
    startCleanupTimer() {
        setInterval(() => {
            this.cleanupExpiredUsers();
            if (this.chatManager) {
                this.chatManager.cleanupOfflineUsers();
            }
        }, 5000);
    }
    
    // 销毁应用
    destroy() {
        if (this.ultrasonicComm) {
            this.ultrasonicComm.destroy();
        }
        
        if (this.chatManager) {
            this.chatManager.destroy();
        }
        
        this.discoveredUserElements.clear();
    }
}

// 应用入口
document.addEventListener('DOMContentLoaded', () => {
    window.chaosChatApp = new ChaosChatApp();
    
    // 启动清理定时器
    window.chaosChatApp.startCleanupTimer();
    
    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
        if (window.chaosChatApp) {
            window.chaosChatApp.destroy();
        }
    });
});

// 注册Service Worker（如果支持）
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                console.log('SW注册成功:', registration);
            })
            .catch(registrationError => {
                console.log('SW注册失败:', registrationError);
            });
    });
} 