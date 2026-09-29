const EXT_KEY = 'st-qq-notification';

const DEFAULT_SETTINGS = {
    enabled: true,
    backgroundOnly: true,
    vibrate: true,
    previewLength: 50,
};

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
    const clean = String(text ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
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
        `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`,
        location.origin,
    ).href;
}

function updateStatus() {
    const el = $('#stq_status');
    if (!el.length) return;

    if (!('Notification' in window)) {
        el.text('当前浏览器不支持系统通知。');
        el.removeClass('ok warn').addClass('err');
        return;
    }

    const permission = Notification.permission;
    if (permission === 'granted') {
        el.text('通知权限：已允许');
        el.removeClass('warn err').addClass('ok');
    } else if (permission === 'denied') {
        el.text('通知权限：已拒绝，请在浏览器/Android 设置中允许。');
        el.removeClass('ok warn').addClass('err');
    } else {
        el.text('通知权限：尚未允许');
        el.removeClass('ok err').addClass('warn');
    }
}

async function requestPermission() {
    if (!('Notification' in window)) {
        updateStatus();
        return;
    }

    try {
        await Notification.requestPermission();
    } catch (error) {
        console.warn('[ST QQ Notification] Permission request failed:', error);
    }
    updateStatus();
}

function makeNotificationOptions(context, message, settings) {
    const body = getPreview(message.mes, settings.previewLength);
    const avatar = getCharacterAvatar(context, message);

    const options = {
        body,
        icon: avatar,
        tag: `${EXT_KEY}-${context.characterId ?? 'chat'}`,
        renotify: true,
        requireInteraction: true,
        data: {
            chatId: context.characterId ?? null,
        },
    };

    if (settings.vibrate) {
        options.vibrate = [180, 90, 180];
    }

    return options;
}

function showNotification(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (settings.backgroundOnly && document.hasFocus()) return;

    const context = SillyTavern.getContext();
    const message = context.chat?.[messageId];

    if (!message || message.is_user || !message.mes || message.mes === '...') return;

    const title = message.name || context.characters?.[context.characterId]?.name || 'SillyTavern';
    const notification = new Notification(title, makeNotificationOptions(context, message, settings));

    notification.onclick = () => {
        window.focus();
        notification.close();
    };

    notification.onerror = (event) => {
        console.warn('[ST QQ Notification] Notification error:', event);
    };
}

function showTestNotification() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
        requestPermission();
        return;
    }

    const settings = getSettings();
    const notification = new Notification('SillyTavern', {
        body: 'QQ式回复通知测试：通知、头像、常驻和震动功能已发送。',
        icon: location.origin + '/favicon.ico',
        tag: `${EXT_KEY}-test`,
        requireInteraction: true,
        renotify: true,
        ...(settings.vibrate ? { vibrate: [180, 90, 180] } : {}),
    });

    notification.onclick = () => {
        window.focus();
        notification.close();
    };
}

async function init() {
    const {
        eventSource,
        event_types,
        renderExtensionTemplateAsync,
    } = SillyTavern.getContext();

    const settings = getSettings();

    try {
        const html = renderExtensionTemplateAsync
            ? await renderExtensionTemplateAsync('third-party/st-qq-notification', 'settings')
            : await $.get('scripts/extensions/third-party/st-qq-notification/settings.html');

        $('#extensions_settings2').append(html);

        $('#stq_enabled').prop('checked', settings.enabled).on('change', function () {
            settings.enabled = $(this).prop('checked');
            saveSettings();
        });

        $('#stq_background_only').prop('checked', settings.backgroundOnly).on('change', function () {
            settings.backgroundOnly = $(this).prop('checked');
            saveSettings();
        });

        $('#stq_vibrate').prop('checked', settings.vibrate).on('change', function () {
            settings.vibrate = $(this).prop('checked');
            saveSettings();
        });

        $('#stq_length').val(settings.previewLength).on('change', function () {
            const value = Math.max(10, Math.min(120, Number.parseInt($(this).val(), 10) || 50));
            settings.previewLength = value;
            $(this).val(value);
            saveSettings();
        });

        $('#stq_permission').on('click', requestPermission);
        $('#stq_test').on('click', showTestNotification);
        updateStatus();
    } catch (error) {
        console.error('[ST QQ Notification] Failed to load settings:', error);
    }

    eventSource.on(event_types.MESSAGE_RECEIVED, showNotification);
    console.log('[ST QQ Notification] Loaded.');
}

export { init };
