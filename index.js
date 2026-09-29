const EXT_KEY = 'st-qq-notification';

const DEFAULT_SETTINGS = {
    enabled: true,
    backgroundOnly: true,
    vibrate: true,
    previewLength: 50,
};

let notificationRegistration = null;
let settingsUiLoaded = false;
let eventsBound = false;

let generationState = null;

function isValidAssistantMessage(message) {
    return Boolean(
        message
        && !message.is_user
        && !message.is_system
        && typeof message.mes === 'string'
        && message.mes.trim()
        && message.mes.trim() !== '...',
    );
}

async function showGenerationInterruptedNotification() {
    const settings = getSettings();

    if (!settings.enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    if (settings.backgroundOnly
        && document.visibilityState === 'visible'
        && document.hasFocus()) {
        return;
    }

    const registration = await getNotificationRegistration();
    if (!registration) return;

    const context = SillyTavern.getContext();
    const character = context.characters?.[context.characterId];
    const title = character?.name || 'SillyTavern';
    const avatar = character?.avatar
        ? new URL(
            '/thumbnail?type=avatar&file=' + encodeURIComponent(character.avatar) + '&width=512&height=512',
            location.origin,
        ).href
        : undefined;

    try {
        await registration.showNotification(title, {
            body: '输出中断或生成失败，请回到酒馆手动重新 Roll。',
            icon: avatar,
            badge: avatar,
            image: avatar,
            tag: EXT_KEY + '-' + (context.characterId ?? 'chat') + '-error',
            requireInteraction: true,
            renotify: true,
            vibrate: settings.vibrate ? [180, 90, 180] : undefined,
            data: {
                url: location.href,
                chatId: context.characterId ?? null,
            },
        });
    } catch (error) {
        console.error('[ST QQ Notification] interruption notification failed:', error);
    }
}

async function handleGenerationStarted() {
    const context = SillyTavern.getContext();
    generationState = {
        chatLength: context.chat?.length ?? 0,
        successNotified: false,
    };
}

async function handleGenerationFinished() {
    const state = generationState;
    if (!state) return;

    await new Promise(resolve => setTimeout(resolve, 400));

    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const newMessages = chat.slice(state.chatLength);

    // 生成结束时再次确认最终聊天内容。
    // 如果 MESSAGE_RECEIVED 因事件时序没有及时触发，这里负责兜底成功通知。
    const replyIndex = (() => {
        for (let i = chat.length - 1; i >= state.chatLength; i--) {
            if (isValidAssistantMessage(chat[i])) return i;
        }
        return -1;
    })();

    if (replyIndex !== -1) {
        if (!state.successNotified) {
            await showNotification(replyIndex);
        }
    } else {
        await showGenerationInterruptedNotification();
    }

    if (generationState === state) generationState = null;
}

function getSettings() {
    const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();

    if (!extensionSettings[EXT_KEY]) {
        extensionSettings[EXT_KEY] = structuredClone(DEFAULT_SETTINGS);
        saveSettingsDebounced();
    }

    const settings = extensionSettings[EXT_KEY];

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in settings)) settings[key] = value;
    }

    return settings;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function getPreview(text, maxLength) {
    let source = String(text ?? '');

    // 思维链不是通知正文。先移除常见的 reasoning / thinking / analysis 块。
    // 这样即使模型没有输出 <content>，通知也不会把思维链当成正文。
    const reasoningPatterns = [
        /<think(?:ing)?(?:\\s[^>]*)?>[\\s\\S]*?<\\/think(?:ing)?>/gi,
        /<analysis(?:\\s[^>]*)?>[\\s\\S]*?<\\/analysis>/gi,
        /<reasoning(?:\\s[^>]*)?>[\\s\\S]*?<\\/reasoning>/gi,
        /<thought(?:s)?(?:\\s[^>]*)?>[\\s\\S]*?<\\/thought(?:s)?>/gi,
    ];
    for (const pattern of reasoningPatterns) {
        source = source.replace(pattern, '');
    }

    // 优先取 <content>，避免把文首状态栏或其他包裹内容当成正文。
    const contentMatch = source.match(/<content(?:\\s[^>]*)?>([\\s\\S]*?)<\\/content>/i);
    if (contentMatch) {
        source = contentMatch[1];
    } else {
        // 去掉常见的 HTML/Markdown 状态栏容器。
        source = source
            .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
            .replace(/<style[\\s\\S]*?<\\/style>/gi, '')
            .replace(/<[^>]*>/g, '');

        // 去掉常见的状态栏包裹标记；正文不受影响。
        source = source
            .replace(/^\\s*(?:\\[?(?:status|state|状态栏|状态)\\]?\\s*[:：]?)[\\s\\S]*?(?:\\n{2,}|\\r\\n{2,})/i, '')
            .replace(/^\\s*[-=~_*]{3,}\\s*$/gm, '');
    }

    const clean = source
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\\s+/g, ' ')
        .trim();

    if (!clean) return '';
    return clean.length > maxLength ? clean.slice(0, maxLength) + '…' : clean;
}
function getCharacterAvatar(context, message) {
    if (message.force_avatar) {
        return new URL(message.force_avatar, location.origin).href;
    }

    const character = context.characters?.[context.characterId];
    if (!character?.avatar) return undefined;

    return new URL(
        `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}&width=512&height=512`,
        location.origin,
    ).href;
}

function updateStatus(message, type = '') {
    const el = $('#stq_status');
    if (!el.length) return;

    if (message) {
        el.text(message);
        el.removeClass('ok warn err');
        if (type) el.addClass(type);
        return;
    }

    if (!('Notification' in window)) {
        el.text('当前浏览器不支持 Web Notification。');
        el.removeClass('ok warn').addClass('err');
        return;
    }

    const permission = Notification.permission;

    if (permission === 'granted') {
        el.text(notificationRegistration
            ? '通知权限：已允许 · Android 通知通道已准备'
            : '通知权限：已允许 · 正在准备通知服务');
        el.removeClass('warn err').addClass('ok');
    } else if (permission === 'denied') {
        el.text('通知权限：已拒绝，请在浏览器/Android 设置中允许。');
        el.removeClass('ok warn').addClass('err');
    } else {
        el.text('通知权限：尚未允许，请点击“请求通知权限”。');
        el.removeClass('ok err').addClass('warn');
    }
}

async function registerNotificationWorker() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('当前浏览器不支持 Service Worker');
    }

    if (!window.isSecureContext) {
        throw new Error('系统通知需要 HTTPS 或 localhost');
    }

    const swUrl = new URL('sw.js', import.meta.url);
    const workerScope = new URL('./', swUrl).href;
    notificationRegistration = await navigator.serviceWorker.register(swUrl, {
        scope: workerScope,
    });

    updateStatus();
    return notificationRegistration;
}

async function requestPermission() {
    if (!('Notification' in window)) {
        updateStatus();
        return false;
    }

    try {
        const permission = await Notification.requestPermission();

        if (permission === 'granted') {
            await registerNotificationWorker();
            updateStatus();
            return true;
        }

        updateStatus();
        return false;
    } catch (error) {
        console.error('[ST QQ Notification] Permission/worker setup failed:', error);
        updateStatus(`通知初始化失败：${error.message || error}`, 'err');
        return false;
    }
}

async function getNotificationRegistration() {
    if (notificationRegistration) return notificationRegistration;
    if (!('serviceWorker' in navigator)) return null;

    try {
        const swUrl = new URL('sw.js', import.meta.url);
        const workerScope = new URL('./', swUrl).href;
        notificationRegistration = await navigator.serviceWorker.getRegistration(workerScope);
        return notificationRegistration;
    } catch (error) {
        console.warn('[ST QQ Notification] Service Worker unavailable:', error);
        return null;
    }
}

async function showNotification(messageId) {
    const settings = getSettings();

    if (!settings.enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    if (settings.backgroundOnly
        && document.visibilityState === 'visible'
        && document.hasFocus()) {
        return;
    }

    const context = SillyTavern.getContext();
    const message = context.chat?.[messageId];

    if (!message || message.is_user || !message.mes || message.mes === '...') return;

    const registration = await getNotificationRegistration();

    if (!registration) {
        updateStatus('通知服务未准备好，请先点击“请求通知权限”。', 'warn');
        return;
    }

    const title = message.name || context.characters?.[context.characterId]?.name || 'SillyTavern';
    const body = getPreview(message.mes, settings.previewLength);
    const tag = `${EXT_KEY}-${context.characterId ?? 'chat'}`;
    const avatar = getCharacterAvatar(context, message);

    try {
        await registration.showNotification(title, {
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
                chatId: context.characterId ?? null,
            },
        });

        if (generationState) {
            generationState.successNotified = true;
        }
    } catch (error) {
        console.error('[ST QQ Notification] showNotification failed:', error);
        updateStatus(`发送通知失败：${error.message || error}`, 'err');
    }
}

async function showTestNotification() {
    if (!('Notification' in window)) {
        updateStatus('当前浏览器不支持系统通知。', 'err');
        return;
    }

    if (Notification.permission !== 'granted') {
        const granted = await requestPermission();
        if (!granted) return;
    }

    const registration = await getNotificationRegistration();

    if (!registration) {
        updateStatus('通知服务未准备好。', 'err');
        return;
    }

    const settings = getSettings();
    const context = SillyTavern.getContext();
    const character = context.characters?.[context.characterId];
    const testAvatar = character?.avatar
        ? new URL(
            `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}&width=512&height=512`,
            location.origin,
        ).href
        : undefined;
    const testTitle = character?.name || 'SillyTavern';

    try {
        await registration.showNotification(testTitle, {
            body: 'QQ式回复通知测试：系统通知、常驻和震动功能已发送。',
            icon: testAvatar,
            badge: testAvatar,
            image: testAvatar,
            tag: `${EXT_KEY}-test`,
            requireInteraction: true,
            renotify: true,
            vibrate: settings.vibrate ? [180, 90, 180] : undefined,
            data: {
                url: location.href,
            },
        });
    } catch (error) {
        console.error('[ST QQ Notification] Test notification failed:', error);
        updateStatus(`测试通知失败：${error.message || error}`, 'err');
    }
}

async function loadSettingsUI() {
    if (settingsUiLoaded) return true;

    try {
        const context = SillyTavern.getContext();
        let html = '';

        if (context.renderExtensionTemplateAsync) {
            try {
                html = await context.renderExtensionTemplateAsync(
                    'third-party/st-qq-notification',
                    'settings',
                );
            } catch (error) {
                console.warn('[ST QQ Notification] Extension template render failed:', error);
            }
        }

        if (!html) {
            try {
                html = await $.get('scripts/extensions/third-party/st-qq-notification/settings.html');
            } catch (error) {
                console.warn('[ST QQ Notification] Settings file load failed:', error);
            }
        }

        // 最终兜底：即使酒馆没有扩展设置容器、模板接口或静态文件加载失败，
        // 也直接生成完整的设置面板。
        if (!html) {
            html = `
                <details id="st_qq_notification_settings" class="stq-settings">
                    <summary>消息通知</summary>
                    <div class="stq-wrap">
                        <div class="stq-row"><label class="checkbox_label"><input id="stq_enabled" type="checkbox"><span>启用通知</span></label></div>
                        <div class="stq-row"><label class="checkbox_label"><input id="stq_background_only" type="checkbox"><span>仅酒馆在后台时通知</span></label></div>
                        <div class="stq-row"><label class="checkbox_label"><input id="stq_vibrate" type="checkbox"><span>震动</span></label></div>
                        <div class="stq-row"><label>消息预览字数 <input id="stq_length" class="text_pole" type="number" min="10" max="120" step="5"></label></div>
                        <div class="stq-actions"><button id="stq_permission" class="menu_button">请求通知权限</button><button id="stq_test" class="menu_button">测试通知</button></div>
                        <div id="stq_status" class="stq-status">检查通知权限中…</div>
                    </div>
                </details>`;
        }

        // 酒馆原生扩展设置区：能找到就正常放进去。
        const nativeTarget = $('#extensions_settings2').length
            ? $('#extensions_settings2')
            : $('#extensions_settings').length
                ? $('#extensions_settings')
                : null;

        if (nativeTarget && nativeTarget.length) {
            nativeTarget.find('#st_qq_notification_settings').remove();
            nativeTarget.append(html);
        }

        // 独立的固定入口：不依赖酒馆设置面板，始终有一个肉眼可见、可点击的“消息通知”按钮。
        $('#stq_guaranteed_entry, #stq_guaranteed_panel').remove();

        const entry = $(`
            <button id="stq_guaranteed_entry" type="button"
                style="position:fixed;right:14px;bottom:82px;z-index:999999;padding:9px 14px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:rgba(30,30,30,.94);color:#fff;font-size:14px;box-shadow:0 3px 14px rgba(0,0,0,.35);cursor:pointer;">
                消息通知
            </button>`);

        const panel = $(`
            <div id="stq_guaranteed_panel"
                style="display:none;position:fixed;right:14px;bottom:128px;z-index:1000000;width:min(360px,calc(100vw - 28px));max-height:70vh;overflow:auto;padding:10px;border-radius:10px;background:rgba(25,25,25,.97);color:#fff;box-shadow:0 5px 24px rgba(0,0,0,.45);">
            </div>`);

        const floatingHtml = html.replace('id="st_qq_notification_settings"', 'id="st_qq_notification_settings_floating"');
        panel.html(floatingHtml);
        $('body').append(entry, panel);

        entry.on('click.stq', () => panel.stop(true, true).fadeToggle(120));

        const root = panel.find('#st_qq_notification_settings_floating');
        const settings = getSettings();

        panel.find('#stq_enabled')
            .prop('checked', settings.enabled)
            .on('change.stq', function () {
                settings.enabled = $(this).prop('checked');
                saveSettings();
            });

        panel.find('#stq_background_only')
            .prop('checked', settings.backgroundOnly)
            .on('change.stq', function () {
                settings.backgroundOnly = $(this).prop('checked');
                saveSettings();
            });

        panel.find('#stq_vibrate')
            .prop('checked', settings.vibrate)
            .on('change.stq', function () {
                settings.vibrate = $(this).prop('checked');
                saveSettings();
            });

        panel.find('#stq_length')
            .val(settings.previewLength)
            .on('change.stq', function () {
                const value = Math.max(10, Math.min(120, Number.parseInt($(this).val(), 10) || 50));
                settings.previewLength = value;
                $(this).val(value);
                saveSettings();
            });

        panel.find('#stq_permission').on('click.stq', requestPermission);
        panel.find('#stq_test').on('click.stq', showTestNotification);

        settingsUiLoaded = true;
        updateStatus();
        return true;
    } catch (error) {
        console.error('[ST QQ Notification] Failed to load settings:', error);
        return false;
    }
}
async function init() {
    const {
        eventSource,
        event_types,
    } = SillyTavern.getContext();

    getSettings();

    if (!(await loadSettingsUI())) {
        if (event_types.APP_READY) {
            eventSource.once(event_types.APP_READY, loadSettingsUI);
        }

        // 某些版本在 APP_READY 后才创建设置容器，再补几次加载，避免插件本身正常运行但设置面板消失。
        for (const delay of [500, 1500, 3000]) {
            setTimeout(() => {
                loadSettingsUI();
            }, delay);
        }
    }

    if (Notification.permission === 'granted') {
        try {
            await registerNotificationWorker();
        } catch (error) {
            console.warn('[ST QQ Notification] Existing permission but worker setup failed:', error);
        }
    }

    if (!eventsBound) {
        eventSource.on(event_types.MESSAGE_RECEIVED, showNotification);

        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, handleGenerationStarted);
        }

        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, handleGenerationFinished);
        }

        if (event_types.GENERATION_STOPPED) {
            eventSource.on(event_types.GENERATION_STOPPED, handleGenerationFinished);
        }

        eventsBound = true;
    }

    console.log('[ST QQ Notification] Loaded.');
}

export { init };
