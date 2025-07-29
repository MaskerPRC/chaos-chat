/**
 * 超声波聊天应用 Service Worker
 * 提供缓存策略和离线功能支持
 */

const CACHE_NAME = 'chaos-chat-v1.0.0';
const STATIC_CACHE_NAME = 'chaos-chat-static-v1.0.0';
const DYNAMIC_CACHE_NAME = 'chaos-chat-dynamic-v1.0.0';

// 需要缓存的静态资源
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './ultrasonic.js',
    './chat.js',
    './manifest.json'
];

// 缓存策略配置
const CACHE_STRATEGIES = {
    // 静态资源：缓存优先
    static: [
        '/index.html',
        '/style.css',
        '/script.js', 
        '/ultrasonic.js',
        '/chat.js',
        '/manifest.json'
    ],
    // 动态内容：网络优先，缓存降级
    dynamic: [
        '/api/'
    ],
    // 仅网络
    networkOnly: [
        '/analytics',
        '/tracking'
    ]
};

// Service Worker 安装事件
self.addEventListener('install', event => {
    console.log('[SW] 安装中...');
    
    event.waitUntil(
        Promise.all([
            // 缓存静态资源
            caches.open(STATIC_CACHE_NAME).then(cache => {
                console.log('[SW] 缓存静态资源');
                return cache.addAll(STATIC_ASSETS);
            }),
            // 跳过等待，立即激活
            self.skipWaiting()
        ])
    );
});

// Service Worker 激活事件
self.addEventListener('activate', event => {
    console.log('[SW] 激活中...');
    
    event.waitUntil(
        Promise.all([
            // 清理旧缓存
            cleanupOldCaches(),
            // 立即控制所有客户端
            self.clients.claim()
        ])
    );
});

// 清理旧缓存
async function cleanupOldCaches() {
    const cacheNames = await caches.keys();
    const validCaches = [STATIC_CACHE_NAME, DYNAMIC_CACHE_NAME];
    
    return Promise.all(
        cacheNames
            .filter(cacheName => !validCaches.includes(cacheName))
            .map(cacheName => {
                console.log('[SW] 删除旧缓存:', cacheName);
                return caches.delete(cacheName);
            })
    );
}

// 网络请求拦截
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    
    // 忽略非HTTP请求
    if (!request.url.startsWith('http')) {
        return;
    }
    
    // 忽略Chrome扩展请求
    if (url.protocol === 'chrome-extension:') {
        return;
    }
    
    // 根据URL确定缓存策略
    const strategy = getCacheStrategy(url.pathname);
    
    event.respondWith(
        handleRequest(request, strategy)
    );
});

// 获取缓存策略
function getCacheStrategy(pathname) {
    if (CACHE_STRATEGIES.networkOnly.some(pattern => pathname.includes(pattern))) {
        return 'networkOnly';
    }
    
    if (CACHE_STRATEGIES.static.some(pattern => pathname.includes(pattern))) {
        return 'cacheFirst';
    }
    
    if (CACHE_STRATEGIES.dynamic.some(pattern => pathname.includes(pattern))) {
        return 'networkFirst';
    }
    
    // 默认策略：网络优先
    return 'networkFirst';
}

// 处理请求
async function handleRequest(request, strategy) {
    switch (strategy) {
        case 'cacheFirst':
            return cacheFirst(request);
        case 'networkFirst':
            return networkFirst(request);
        case 'networkOnly':
            return networkOnly(request);
        default:
            return networkFirst(request);
    }
}

// 缓存优先策略
async function cacheFirst(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        const networkResponse = await fetch(request);
        
        // 缓存新响应
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('[SW] 缓存优先策略失败:', error);
        return createErrorResponse('缓存不可用，网络连接失败');
    }
}

// 网络优先策略
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        
        // 缓存成功的响应
        if (networkResponse.ok) {
            const cache = await caches.open(DYNAMIC_CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('[SW] 网络请求失败，尝试缓存:', error);
        
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // 如果是导航请求，返回离线页面
        if (request.mode === 'navigate') {
            return caches.match('./index.html');
        }
        
        return createErrorResponse('网络不可用，缓存中没有找到资源');
    }
}

// 仅网络策略
async function networkOnly(request) {
    try {
        return await fetch(request);
    } catch (error) {
        console.log('[SW] 网络请求失败:', error);
        return createErrorResponse('网络连接失败');
    }
}

// 创建错误响应
function createErrorResponse(message) {
    return new Response(
        JSON.stringify({
            error: true,
            message: message,
            timestamp: Date.now()
        }),
        {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );
}

// 消息处理
self.addEventListener('message', event => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'GET_VERSION':
            event.ports[0].postMessage({ version: CACHE_NAME });
            break;
            
        case 'CLEAR_CACHE':
            clearAllCaches().then(() => {
                event.ports[0].postMessage({ success: true });
            });
            break;
            
        case 'CACHE_STATUS':
            getCacheStatus().then(status => {
                event.ports[0].postMessage(status);
            });
            break;
            
        default:
            console.log('[SW] 未知消息类型:', type);
    }
});

// 清空所有缓存
async function clearAllCaches() {
    const cacheNames = await caches.keys();
    return Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
    );
}

// 获取缓存状态
async function getCacheStatus() {
    try {
        const cacheNames = await caches.keys();
        const status = {};
        
        for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            status[cacheName] = {
                count: keys.length,
                urls: keys.map(request => request.url)
            };
        }
        
        return {
            success: true,
            caches: status,
            totalCaches: cacheNames.length
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// 后台同步支持
self.addEventListener('sync', event => {
    console.log('[SW] 后台同步:', event.tag);
    
    switch (event.tag) {
        case 'background-sync':
            event.waitUntil(performBackgroundSync());
            break;
            
        case 'retry-failed-requests':
            event.waitUntil(retryFailedRequests());
            break;
    }
});

// 执行后台同步
async function performBackgroundSync() {
    try {
        console.log('[SW] 执行后台同步任务');
        
        // 这里可以添加需要在后台同步的任务
        // 例如：发送未发送的消息、同步用户状态等
        
        // 通知所有客户端同步完成
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'BACKGROUND_SYNC_COMPLETE',
                timestamp: Date.now()
            });
        });
        
    } catch (error) {
        console.error('[SW] 后台同步失败:', error);
    }
}

// 重试失败的请求
async function retryFailedRequests() {
    // 实现重试逻辑
    console.log('[SW] 重试失败的请求');
}

// 推送通知处理
self.addEventListener('push', event => {
    console.log('[SW] 收到推送消息');
    
    const options = {
        body: '您有新的消息',
        icon: './icon-192.png',
        badge: './badge-72.png',
        tag: 'chat-message',
        data: {
            timestamp: Date.now(),
            url: './'
        },
        actions: [
            {
                action: 'open',
                title: '查看消息'
            },
            {
                action: 'close',
                title: '关闭'
            }
        ],
        requireInteraction: true
    };
    
    if (event.data) {
        try {
            const pushData = event.data.json();
            options.body = pushData.message || options.body;
            options.data = { ...options.data, ...pushData };
        } catch (error) {
            console.log('[SW] 推送数据解析失败:', error);
        }
    }
    
    event.waitUntil(
        self.registration.showNotification('超声波聊天', options)
    );
});

// 通知点击处理
self.addEventListener('notificationclick', event => {
    console.log('[SW] 通知被点击:', event.action);
    
    event.notification.close();
    
    switch (event.action) {
        case 'open':
            event.waitUntil(
                self.clients.openWindow(event.notification.data?.url || './')
            );
            break;
        case 'close':
            // 不做任何操作，只关闭通知
            break;
        default:
            // 默认打开应用
            event.waitUntil(
                self.clients.openWindow('./')
            );
    }
});

// 错误处理
self.addEventListener('error', event => {
    console.error('[SW] Service Worker错误:', event.error);
});

self.addEventListener('unhandledrejection', event => {
    console.error('[SW] 未处理的Promise拒绝:', event.reason);
});

// 定期清理缓存
self.addEventListener('periodicsync', event => {
    if (event.tag === 'cache-cleanup') {
        event.waitUntil(performCacheCleanup());
    }
});

// 执行缓存清理
async function performCacheCleanup() {
    try {
        const cache = await caches.open(DYNAMIC_CACHE_NAME);
        const requests = await cache.keys();
        
        // 删除超过24小时的缓存项
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24小时
        
        for (const request of requests) {
            const response = await cache.match(request);
            const cacheTime = response.headers.get('sw-cache-time');
            
            if (cacheTime && now - parseInt(cacheTime) > maxAge) {
                await cache.delete(request);
                console.log('[SW] 清理过期缓存:', request.url);
            }
        }
    } catch (error) {
        console.error('[SW] 缓存清理失败:', error);
    }
}

console.log('[SW] Service Worker 已加载'); 