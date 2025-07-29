/**
 * 超声波通信模块
 * 使用Web Audio API实现18-19kHz超声波数据传输
 * 支持2-FSK调制解调和错误检测
 */

class UltrasonicComm {
    constructor() {
        this.audioContext = null;
        this.isInitialized = false;
        this.isTransmitting = false;
        this.isReceiving = false;
        
        // 频率配置
        this.config = {
            high: {
                freq0: 18700, // 0比特频率
                freq1: 19300, // 1比特频率
                bitRate: 40   // 比特率 (bps)
            },
            low: {
                freq0: 17500, // 低频模式
                freq1: 18100,
                bitRate: 10
            }
        };
        
        this.currentMode = 'high';
        this.volume = 0.8;
        this.sampleRate = 48000;
        
        // 接收相关
        this.analyser = null;
        this.microphone = null;
        this.dataArray = null;
        this.receiverWorklet = null;
        
        // 数据包格式
        this.packetHeader = [1, 0, 1, 0, 1, 1, 0, 1]; // 同步头
        this.maxPayloadLength = 32; // 最大载荷长度
        
        // 回调函数
        this.onDataReceived = null;
        this.onUserDetected = null;
        this.onStatusChange = null;
        
        // 已发现的用户
        this.discoveredUsers = new Map();
        this.myUserId = this.generateUserId();
        
        // 心跳和发现
        this.heartbeatInterval = null;
        this.discoveryInterval = null;
        
        this.init();
    }
    
    async init() {
        try {
            // 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.sampleRate
            });
            
            // 加载AudioWorklet处理器
            if (this.audioContext.audioWorklet) {
                await this.loadAudioWorklet();
            }
            
            this.isInitialized = true;
            this.updateStatus('ready', '超声波系统就绪');
            
            console.log('超声波通信系统初始化完成');
        } catch (error) {
            console.error('初始化失败:', error);
            this.updateStatus('error', '初始化失败');
        }
    }
    
    async loadAudioWorklet() {
        // 创建AudioWorklet处理器代码
        const workletCode = `
        class UltrasonicProcessor extends AudioWorkletProcessor {
            constructor() {
                super();
                this.bufferSize = 4096;
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
                this.threshold = 0.01;
                this.freqs = [18700, 19300]; // 默认高频模式
                this.sampleRate = 48000;
                this.bitDuration = this.sampleRate / 40; // 40 bps
                this.lastBitTime = 0;
                
                this.port.onmessage = (e) => {
                    if (e.data.type === 'config') {
                        this.freqs = [e.data.freq0, e.data.freq1];
                        this.bitDuration = this.sampleRate / e.data.bitRate;
                    }
                };
            }
            
            process(inputs, outputs, parameters) {
                const input = inputs[0];
                if (input.length > 0) {
                    const channelData = input[0];
                    
                    // 将音频数据复制到缓冲区
                    for (let i = 0; i < channelData.length; i++) {
                        this.buffer[this.bufferIndex] = channelData[i];
                        this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
                        
                        // 每当缓冲区填满时进行频率检测
                        if (this.bufferIndex === 0) {
                            this.detectFrequency();
                        }
                    }
                }
                return true;
            }
            
            detectFrequency() {
                // 简化的Goertzel算法检测特定频率
                const result0 = this.goertzel(this.freqs[0]);
                const result1 = this.goertzel(this.freqs[1]);
                
                if (result0 > this.threshold || result1 > this.threshold) {
                    const bit = result1 > result0 ? 1 : 0;
                    const currentTime = currentFrame / this.sampleRate;
                    
                    // 防止重复检测
                    if (currentTime - this.lastBitTime > this.bitDuration * 0.8) {
                        this.port.postMessage({
                            type: 'bit',
                            bit: bit,
                            strength: Math.max(result0, result1),
                            timestamp: currentTime
                        });
                        this.lastBitTime = currentTime;
                    }
                }
            }
            
            goertzel(frequency) {
                const k = Math.round(this.bufferSize * frequency / this.sampleRate);
                const w = 2 * Math.PI * k / this.bufferSize;
                const cosw = Math.cos(w);
                
                let d1 = 0, d2 = 0;
                
                for (let i = 0; i < this.bufferSize; i++) {
                    const y = this.buffer[i] + 2 * cosw * d1 - d2;
                    d2 = d1;
                    d1 = y;
                }
                
                return Math.sqrt(d1 * d1 + d2 * d2 - 2 * cosw * d1 * d2) / this.bufferSize;
            }
        }
        
        registerProcessor('ultrasonic-processor', UltrasonicProcessor);
        `;
        
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        
        try {
            await this.audioContext.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl);
        } catch (error) {
            console.error('AudioWorklet加载失败:', error);
        }
    }
    
    async startReceiving() {
        if (!this.isInitialized || this.isReceiving) return;
        
        try {
            // 请求麦克风权限
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: this.sampleRate,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            
            // 创建音频节点
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            
            if (this.audioContext.audioWorklet) {
                // 使用AudioWorklet
                this.receiverWorklet = new AudioWorkletNode(this.audioContext, 'ultrasonic-processor');
                this.microphone.connect(this.receiverWorklet);
                
                // 配置处理器
                const currentConfig = this.config[this.currentMode];
                this.receiverWorklet.port.postMessage({
                    type: 'config',
                    freq0: currentConfig.freq0,
                    freq1: currentConfig.freq1,
                    bitRate: currentConfig.bitRate
                });
                
                // 监听检测到的比特
                this.receiverWorklet.port.onmessage = (e) => {
                    if (e.data.type === 'bit') {
                        this.processBit(e.data.bit, e.data.timestamp);
                    }
                };
            } else {
                // 降级到AnalyserNode
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 4096;
                this.microphone.connect(this.analyser);
                this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
                this.startFallbackReceiver();
            }
            
            this.isReceiving = true;
            this.updateStatus('receiving', '正在监听');
            console.log('开始接收超声波信号');
            
        } catch (error) {
            console.error('启动接收失败:', error);
            this.updateStatus('error', '无法访问麦克风');
        }
    }
    
    stopReceiving() {
        if (!this.isReceiving) return;
        
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }
        
        if (this.receiverWorklet) {
            this.receiverWorklet.disconnect();
            this.receiverWorklet = null;
        }
        
        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }
        
        this.isReceiving = false;
        this.updateStatus('ready', '已停止监听');
        console.log('停止接收超声波信号');
    }
    
    // 降级接收器（使用AnalyserNode）
    startFallbackReceiver() {
        const detectLoop = () => {
            if (!this.isReceiving) return;
            
            this.analyser.getFloatFrequencyData(this.dataArray);
            
            const currentConfig = this.config[this.currentMode];
            const bin0 = Math.round(currentConfig.freq0 * this.analyser.fftSize / this.sampleRate);
            const bin1 = Math.round(currentConfig.freq1 * this.analyser.fftSize / this.sampleRate);
            
            const power0 = this.dataArray[bin0];
            const power1 = this.dataArray[bin1];
            const threshold = -60; // dB
            
            if (power0 > threshold || power1 > threshold) {
                const bit = power1 > power0 ? 1 : 0;
                this.processBit(bit, this.audioContext.currentTime);
            }
            
            requestAnimationFrame(detectLoop);
        };
        detectLoop();
    }
    
    // 发送数据
    async transmitData(data) {
        if (!this.isInitialized || this.isTransmitting) return false;
        
        try {
            // 确保音频上下文处于运行状态
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            this.isTransmitting = true;
            this.updateStatus('transmitting', '正在发送');
            
            // 编码数据
            const packet = this.encodePacket(data);
            const bits = this.createBitStream(packet);
            
            // 生成音频信号
            await this.generateTone(bits);
            
            this.isTransmitting = false;
            this.updateStatus('ready', '发送完成');
            
            return true;
        } catch (error) {
            console.error('发送失败:', error);
            this.isTransmitting = false;
            this.updateStatus('error', '发送失败');
            return false;
        }
    }
    
    // 生成音频信号
    async generateTone(bits) {
        const currentConfig = this.config[this.currentMode];
        const bitDuration = 1 / currentConfig.bitRate;
        const totalDuration = bits.length * bitDuration;
        
        // 创建音频缓冲区
        const bufferSize = Math.ceil(totalDuration * this.sampleRate);
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.sampleRate);
        const channelData = buffer.getChannelData(0);
        
        // 生成FSK信号
        let sampleIndex = 0;
        for (let i = 0; i < bits.length; i++) {
            const bit = bits[i];
            const frequency = bit ? currentConfig.freq1 : currentConfig.freq0;
            const samplesPerBit = Math.floor(bitDuration * this.sampleRate);
            
            // 生成正弦波
            for (let j = 0; j < samplesPerBit && sampleIndex < bufferSize; j++) {
                const t = sampleIndex / this.sampleRate;
                channelData[sampleIndex] = Math.sin(2 * Math.PI * frequency * t) * this.volume;
                sampleIndex++;
            }
        }
        
        // 播放音频
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start();
        
        // 等待播放完成
        return new Promise(resolve => {
            source.onended = resolve;
        });
    }
    
    // 数据包编码
    encodePacket(data) {
        const payload = new TextEncoder().encode(JSON.stringify(data));
        
        // 限制载荷长度
        if (payload.length > this.maxPayloadLength) {
            throw new Error('数据包过大');
        }
        
        // 构建数据包：头部 + 长度 + 载荷 + CRC
        const packet = new Uint8Array(this.packetHeader.length + 1 + payload.length + 1);
        let offset = 0;
        
        // 同步头
        for (let i = 0; i < this.packetHeader.length; i++) {
            packet[offset++] = this.packetHeader[i];
        }
        
        // 载荷长度
        packet[offset++] = payload.length;
        
        // 载荷数据
        for (let i = 0; i < payload.length; i++) {
            packet[offset++] = payload[i];
        }
        
        // 简单的CRC
        packet[offset] = this.calculateCRC(payload);
        
        return packet;
    }
    
    // 创建比特流
    createBitStream(packet) {
        const bits = [];
        
        for (let i = 0; i < packet.length; i++) {
            const byte = packet[i];
            // 将字节转换为8个比特（LSB first）
            for (let j = 0; j < 8; j++) {
                bits.push((byte >> j) & 1);
            }
        }
        
        return bits;
    }
    
    // 比特处理和数据包重建
    processBit(bit, timestamp) {
        if (!this.bitBuffer) {
            this.bitBuffer = [];
            this.lastBitTime = timestamp;
        }
        
        // 检查比特间隔是否合理
        const timeDiff = timestamp - this.lastBitTime;
        const expectedInterval = 1 / this.config[this.currentMode].bitRate;
        
        if (timeDiff > expectedInterval * 2) {
            // 间隔过长，重置缓冲区
            this.bitBuffer = [];
        }
        
        this.bitBuffer.push(bit);
        this.lastBitTime = timestamp;
        
        // 尝试同步和解码
        this.tryDecodePacket();
    }
    
    // 尝试解码数据包
    tryDecodePacket() {
        if (this.bitBuffer.length < (this.packetHeader.length + 2) * 8) return;
        
        // 查找同步头
        for (let i = 0; i <= this.bitBuffer.length - this.packetHeader.length * 8; i += 8) {
            if (this.matchHeader(i)) {
                const packet = this.extractPacket(i);
                if (packet) {
                    this.handleReceivedPacket(packet);
                    // 清理已处理的比特
                    this.bitBuffer = this.bitBuffer.slice(i + packet.length * 8);
                    return;
                }
            }
        }
        
        // 清理过长的缓冲区
        if (this.bitBuffer.length > 1000) {
            this.bitBuffer = this.bitBuffer.slice(-500);
        }
    }
    
    // 匹配同步头
    matchHeader(startIndex) {
        for (let i = 0; i < this.packetHeader.length; i++) {
            const byteStartIndex = startIndex + i * 8;
            let byte = 0;
            
            for (let j = 0; j < 8; j++) {
                byte |= this.bitBuffer[byteStartIndex + j] << j;
            }
            
            if (byte !== this.packetHeader[i]) {
                return false;
            }
        }
        return true;
    }
    
    // 提取数据包
    extractPacket(startIndex) {
        const headerLen = this.packetHeader.length * 8;
        const lengthIndex = startIndex + headerLen;
        
        if (lengthIndex + 8 > this.bitBuffer.length) return null;
        
        // 提取载荷长度
        let payloadLength = 0;
        for (let i = 0; i < 8; i++) {
            payloadLength |= this.bitBuffer[lengthIndex + i] << i;
        }
        
        if (payloadLength > this.maxPayloadLength) return null;
        
        const totalPacketBits = (this.packetHeader.length + 1 + payloadLength + 1) * 8;
        if (startIndex + totalPacketBits > this.bitBuffer.length) return null;
        
        // 提取完整数据包
        const packetBytes = [];
        for (let i = 0; i < this.packetHeader.length + 1 + payloadLength + 1; i++) {
            let byte = 0;
            const byteIndex = startIndex + i * 8;
            for (let j = 0; j < 8; j++) {
                byte |= this.bitBuffer[byteIndex + j] << j;
            }
            packetBytes.push(byte);
        }
        
        // 验证CRC
        const payload = packetBytes.slice(this.packetHeader.length + 1, -1);
        const receivedCRC = packetBytes[packetBytes.length - 1];
        const calculatedCRC = this.calculateCRC(new Uint8Array(payload));
        
        if (receivedCRC === calculatedCRC) {
            return {
                payload: new Uint8Array(payload),
                length: packetBytes.length
            };
        }
        
        return null;
    }
    
    // 处理接收到的数据包
    handleReceivedPacket(packet) {
        try {
            const jsonData = new TextDecoder().decode(packet.payload);
            const data = JSON.parse(jsonData);
            
            console.log('接收到数据:', data);
            
            if (this.onDataReceived) {
                this.onDataReceived(data);
            }
            
            // 处理不同类型的消息
            this.handleMessage(data);
            
        } catch (error) {
            console.error('数据包解析失败:', error);
        }
    }
    
    // 处理消息
    handleMessage(data) {
        switch (data.type) {
            case 'heartbeat':
                this.handleHeartbeat(data);
                break;
            case 'discovery':
                this.handleDiscovery(data);
                break;
            case 'chat':
                this.handleChatMessage(data);
                break;
            case 'invite':
                this.handleInvite(data);
                break;
        }
    }
    
    // 处理心跳消息
    handleHeartbeat(data) {
        const userId = data.userId;
        if (userId !== this.myUserId) {
            this.discoveredUsers.set(userId, {
                ...data,
                lastSeen: Date.now()
            });
            
            if (this.onUserDetected) {
                this.onUserDetected(userId, data);
            }
        }
    }
    
    // 处理发现消息
    handleDiscovery(data) {
        this.handleHeartbeat(data);
    }
    
    // 处理聊天消息
    handleChatMessage(data) {
        if (this.onDataReceived) {
            this.onDataReceived(data);
        }
    }
    
    // 处理邀请
    handleInvite(data) {
        if (this.onDataReceived) {
            this.onDataReceived(data);
        }
    }
    
    // 发送心跳
    async sendHeartbeat() {
        const heartbeat = {
            type: 'heartbeat',
            userId: this.myUserId,
            username: this.getUsername(),
            timestamp: Date.now()
        };
        
        await this.transmitData(heartbeat);
    }
    
    // 发送发现信号
    async sendDiscovery() {
        const discovery = {
            type: 'discovery',
            userId: this.myUserId,
            username: this.getUsername(),
            timestamp: Date.now()
        };
        
        await this.transmitData(discovery);
    }
    
    // 开始自动发现
    startDiscovery() {
        this.startReceiving();
        
        // 定期发送心跳
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, 3000);
        
        // 定期清理过期用户
        this.discoveryInterval = setInterval(() => {
            this.cleanupExpiredUsers();
        }, 5000);
        
        // 立即发送一次发现信号
        setTimeout(() => this.sendDiscovery(), 1000);
    }
    
    // 停止自动发现
    stopDiscovery() {
        this.stopReceiving();
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }
    }
    
    // 清理过期用户
    cleanupExpiredUsers() {
        const now = Date.now();
        const timeout = 10000; // 10秒超时
        
        for (const [userId, user] of this.discoveredUsers.entries()) {
            if (now - user.lastSeen > timeout) {
                this.discoveredUsers.delete(userId);
                console.log('用户离线:', userId);
            }
        }
    }
    
    // 工具函数
    generateUserId() {
        return Math.random().toString(36).substr(2, 9);
    }
    
    getUsername() {
        return localStorage.getItem('username') || '用户' + this.myUserId.substr(0, 4);
    }
    
    calculateCRC(data) {
        let crc = 0;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
        }
        return crc & 0xFF;
    }
    
    // 设置配置
    setMode(mode) {
        if (this.config[mode]) {
            this.currentMode = mode;
            
            // 更新接收器配置
            if (this.receiverWorklet) {
                const currentConfig = this.config[this.currentMode];
                this.receiverWorklet.port.postMessage({
                    type: 'config',
                    freq0: currentConfig.freq0,
                    freq1: currentConfig.freq1,
                    bitRate: currentConfig.bitRate
                });
            }
        }
    }
    
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume / 100));
    }
    
    // 状态更新
    updateStatus(status, message) {
        if (this.onStatusChange) {
            this.onStatusChange(status, message);
        }
    }
    
    // 获取发现的用户
    getDiscoveredUsers() {
        return Array.from(this.discoveredUsers.values());
    }
    
    // 销毁
    destroy() {
        this.stopDiscovery();
        
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.discoveredUsers.clear();
    }
}

// 导出
window.UltrasonicComm = UltrasonicComm; 