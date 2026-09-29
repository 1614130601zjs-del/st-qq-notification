/**
 * 消息通知 · 酒馆助手脚本
 * 用途：角色回复完成后发送 Android/浏览器系统通知。
 *
 * 依赖：酒馆助手 Tavern Helper
 * 默认：启用、仅后台通知、震动、预览 50 字
 */

const NOTIFY_KEY = 'stq_tavern_helper_settings_v1';

const DEFAULTS = {
    enabled: true,
    backgroundOnly: true,
    vibrate: true,
    previewLength: 50,
};

let settings = loadSettings();
let generationStarted = false;
let generationHandled = false;

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}');
        return { ...DEFAULTS, ...saved };
    } catch {
        return { ...DEFAULTS };
    }
}

function saveSettings() {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(settings));
}

function getContext() {
    return SillyTavern.getContext();
}

function getCharacter() {
    const context = getContext();
    return context.characters?.[context.characterId];
}

function getAvatar() {
    const character = getCharacter();
    if (!character?.avatar) return undefined;

    return new URL(
        '/thumbnail?type=avatar&file=' + encodeURIComponent(character.avatar) + '&width=512&height=512',
        location.origin,
    ).href;
}

function isAssistant(message) {
    return Boolean(
        message &&
        !message.is_user &&
        !message.is_system &&
        typeof message.mes === 'string' &&
        message.mes.trim() &&
        message.mes.trim() !== '...',
    );
}

function getPreview(text) {
    let source = String(text ?? '');

    // 思维链不进入通知正文。
    for (const pattern of [
        /<think(?:ing)?(?:\s[^>]*)?>[\s\S]*?<\/think(?:ing)?>/gi,
        /<analysis(?:\s[^>]*)?>[\s\S]*?<\/analysis>/gi,
        /<reasoning(?:\s[^>]*)?>[\s\S]*?<\/reasoning>/gi,
        /<thought(?:s)?(?:\s[^>]*)?>[\s\S]*?<\/thought(?:s)?>/gi,
    ]) {
        source = source.replace(pattern, '');
    }

    // 有 <content> 时，只取 content 内部。
    // </content> 后面的状态栏等内容不会进入通知。
    const content = source.match(/<content(?:\s[^>]*)?>([\s\S]*?)<\/content>/i);
    if (content) {
        source = content[1];
    } else {
        source = source
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, '');
    }

    const clean = source
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();

    if (!clean) return '';
    return clean.length > settings.previewLength
        ? clean.slice(0, settings.previewLength) + '…'
        : clean;
}

function canNotify() {
    if (!settings.enabled) return false;
    if (!('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;

    if (
        settings.backgroundOnly &&
        document.visibilityState === 'visible' &&
        document.hasFocus()
    ) {
        return false;
    }

    return true;
}

async function requestPermission() {
    if (!('Notification' in window)) {
        toastr.error('当前浏览器不支持系统通知');
        return;
    }

    const result = await Notification.requestPermission();
    updatePanelStatus();

    if (result === 'granted') {
        toastr.success('通知权限已允许');
    } else {
        toastr.warning('通知权限未允许');
    }
}

function focusTavern() {
    try {
        window.focus();
    } catch {}

    document.body?.focus?.();
}

function sendNotification(title, body, tag) {
    if (!canNotify()) return;

    const avatar = getAvatar();

    const notification = new Notification(title, {
        body,
        icon: avatar,
        badge: avatar,
        image: avatar,
        tag,
        requireInteraction: true,
        renotify: true,
        vibrate: settings.vibrate ? [180, 90, 180] : undefined,
        data: {
            url: location.href,
        },
    });

    notification.onclick = () => {
        notification.close();
        focusTavern();
    };
}

function notifyMessage(messageId) {
    const context = getContext();
    const message = context.chat?.[messageId];

    if (!isAssistant(message)) return;

    const body = getPreview(message.mes);
    if (!body) return;

    const character = getCharacter();
    const title = message.name || character?.name || 'SillyTavern';
    const tag = 'stq-' + (context.characterId ?? 'chat');

    sendNotification(title, body, tag);
    generationHandled = true;
}

function notifyInterrupted() {
    const character = getCharacter();
    const context = getContext();
    const title = character?.name || 'SillyTavern';

    sendNotification(
        title,
        '输出中断或生成失败，请回到酒馆手动重新 Roll。',
        'stq-' + (context.characterId ?? 'chat') + '-error',
    );
}

function getLatestAssistantMessage() {
    try {
        const messages = getChatMessages(-1, { role: 'assistant' });
        return messages?.[0];
    } catch {
        const context = getContext();
        const chat = context.chat || [];
        return chat[chat.length - 1];
    }
}

async function handleGenerationStopped() {
    if (!generationStarted || generationHandled) return;

    // 给酒馆一点时间写入最后一楼。
    await new Promise(resolve => setTimeout(resolve, 500));

    const latest = getLatestAssistantMessage();

    if (!isAssistant(latest)) {
        notifyInterrupted();
    }

    generationStarted = false;
    generationHandled = false;
}

function showTestNotification() {
    if (!('Notification' in window)) {
        toastr.error('当前浏览器不支持系统通知');
        return;
    }

    if (Notification.permission !== 'granted') {
        requestPermission();
        return;
    }

    const character = getCharacter();
    sendNotification(
        character?.name || '消息通知',
        '这是一条测试通知。',
        'stq-test',
    );
}

function updatePanelStatus() {
    const el = document.getElementById('stq_th_status');
    if (!el) return;

    if (!('Notification' in window)) {
        el.textContent = '当前浏览器不支持系统通知';
        return;
    }

    el.textContent = '通知权限：' + (
        Notification.permission === 'granted'
            ? '已允许'
            : Notification.permission === 'denied'
                ? '已拒绝'
                : '未请求'
    );
}

function openSettings() {
    let panel = document.getElementById('stq_th_panel');

    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'stq_th_panel';
        panel.innerHTML = `
            <div id="stq_th_box">
                <div class="stq_th_title">消息通知</div>

                <label><input id="stq_th_enabled" type="checkbox"> 启用通知</label>
                <label><input id="stq_th_background" type="checkbox"> 仅酒馆在后台时通知</label>
                <label><input id="stq_th_vibrate" type="checkbox"> 震动</label>

                <label class="stq_th_length">
                    消息预览字数
                    <input id="stq_th_length" type="number" min="10" max="120" step="5">
                </label>

                <div class="stq_th_buttons">
                    <button id="stq_th_permission">请求通知权限</button>
                    <button id="stq_th_test">测试通知</button>
                </div>

                <div id="stq_th_status"></div>
            </div>
        `;

        const style = document.createElement('style');
        style.id = 'stq_th_style';
        style.textContent = `
            #stq_th_panel {
                position: fixed;
                inset: 0;
                z-index: 9999999;
                background: rgba(0,0,0,.42);
                display: flex;
                align-items: flex-end;
                justify-content: center;
                padding: 14px;
                box-sizing: border-box;
            }
            #stq_th_box {
                width: min(430px, 100%);
                max-height: 78vh;
                overflow: auto;
                padding: 16px;
                box-sizing: border-box;
                border-radius: 16px;
                background: var(--SmartThemeBodyColor, #202020);
                color: var(--SmartThemeBodyColorText, #fff);
                box-shadow: 0 8px 30px rgba(0,0,0,.5);
            }
            #stq_th_title {
                font-size: 18px;
                font-weight: 700;
                margin-bottom: 14px;
            }
            #stq_th_box label {
                display: flex;
                align-items: center;
                gap: 8px;
                margin: 12px 0;
            }
            #stq_th_box input[type="number"] {
                width: 80px;
                margin-left: auto;
            }
            .stq_th_buttons {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin-top: 16px;
            }
            .stq_th_buttons button {
                padding: 8px 12px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,.18);
                background: rgba(127,127,127,.16);
                color: inherit;
            }
            #stq_th_status {
                margin-top: 12px;
                opacity: .72;
                font-size: 13px;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);

        panel.addEventListener('click', event => {
            if (event.target === panel) panel.remove();
        });

        document.getElementById('stq_th_enabled').onchange = event => {
            settings.enabled = event.target.checked;
            saveSettings();
        };

        document.getElementById('stq_th_background').onchange = event => {
            settings.backgroundOnly = event.target.checked;
            saveSettings();
        };

        document.getElementById('stq_th_vibrate').onchange = event => {
            settings.vibrate = event.target.checked;
            saveSettings();
        };

        document.getElementById('stq_th_length').onchange = event => {
            settings.previewLength = Math.max(
                10,
                Math.min(120, Number.parseInt(event.target.value, 10) || 50),
            );
            event.target.value = settings.previewLength;
            saveSettings();
        };

        document.getElementById('stq_th_permission').onclick = requestPermission;
        document.getElementById('stq_th_test').onclick = showTestNotification;
    }

    document.getElementById('stq_th_enabled').checked = settings.enabled;
    document.getElementById('stq_th_background').checked = settings.backgroundOnly;
    document.getElementById('stq_th_vibrate').checked = settings.vibrate;
    document.getElementById('stq_th_length').value = settings.previewLength;

    updatePanelStatus();
}

appendInexistentScriptButtons([
    { name: '消息通知', visible: true },
]);

eventOn(getButtonEvent('消息通知'), openSettings);

eventOn(tavern_events.MESSAGE_RECEIVED, messageId => {
    notifyMessage(messageId);
});

eventOn(tavern_events.GENERATION_STARTED, () => {
    generationStarted = true;
    generationHandled = false;
});

eventOn(tavern_events.GENERATION_STOPPED, handleGenerationStopped);

console.log('[消息通知] 酒馆助手脚本已加载');
