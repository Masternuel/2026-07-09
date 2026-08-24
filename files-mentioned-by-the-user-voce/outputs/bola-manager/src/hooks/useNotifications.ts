import { useCallback, useEffect, useState } from 'react';
import { useUserPreferences } from '../preferences/UserPreferencesContext';
import {
  notificationCategoryEnabled,
  type NotificationCategory,
} from '../preferences/userPreferences';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

interface BrowserNotificationOptions {
  onlyWhenHidden?: boolean;
}

export function browserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export function useNotifications() {
  const settings = useUserPreferences();
  const [permission, setPermission] = useState<BrowserNotificationPermission>(
    browserNotificationPermission,
  );
  const [error, setError] = useState<string | null>(null);
  const supported = permission !== 'unsupported';

  const refreshPermission = useCallback(() => {
    setPermission(browserNotificationPermission());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('focus', refreshPermission);
    document.addEventListener('visibilitychange', refreshPermission);
    return () => {
      window.removeEventListener('focus', refreshPermission);
      document.removeEventListener('visibilitychange', refreshPermission);
    };
  }, [refreshPermission]);

  const requestPermission = useCallback(async (): Promise<BrowserNotificationPermission> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return 'unsupported';
    }
    setError(null);
    try {
      const next = await window.Notification.requestPermission();
      setPermission(next);
      return next;
    } catch {
      setError('O navegador não concluiu a solicitação de notificações.');
      refreshPermission();
      return browserNotificationPermission();
    }
  }, [refreshPermission]);

  const notify = useCallback((
    category: NotificationCategory,
    title: string,
    body: string,
    options: BrowserNotificationOptions = {},
  ) => {
    if (
      typeof window === 'undefined'
      || permission !== 'granted'
      || settings.status !== 'saved'
      || !notificationCategoryEnabled(settings.preferences.notifications, category)
      || !('Notification' in window)
      || (options.onlyWhenHidden && typeof document !== 'undefined' && document.visibilityState !== 'hidden')
    ) {
      return false;
    }
    try {
      new window.Notification(title, { body, icon: '/favicon.svg' });
      return true;
    } catch {
      setError('O navegador não conseguiu exibir a notificação.');
      return false;
    }
  }, [permission, settings.preferences.notifications, settings.status]);

  return {
    supported,
    permission,
    error,
    requestPermission,
    refreshPermission,
    notify,
  };
}
