import { useState } from 'react';

export function useNotifications() {
  const supported = 'Notification' in window;
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'denied');

  async function requestPermission() {
    if (!supported) return 'denied' as const;
    const next = await Notification.requestPermission();
    setPermission(next);
    return next;
  }

  function notify(title: string, body: string) {
    if (permission === 'granted') new Notification(title, { body, icon: '/favicon.svg' });
  }

  return { supported, permission, requestPermission, notify };
}
