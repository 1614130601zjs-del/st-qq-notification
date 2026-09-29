self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || self.registration.scope;

    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
        });

        for (const client of clients) {
            if ('focus' in client) {
                await client.focus();
                return;
            }
        }

        if (self.clients.openWindow) {
            await self.clients.openWindow(targetUrl);
        }
    })());
});

self.addEventListener('notificationclose', () => {
    // Intentionally empty: persistent notifications are controlled by the user.
});
