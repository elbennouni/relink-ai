/**
 * Registers the device for Expo push notifications and sends the token to our API.
 * Call this hook once from the authenticated root layout.
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { customFetch } from '@workspace/api-client-react';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[Push] Notifications not supported in simulator');
    return null;
  }

  // Android: create a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages WhatsApp',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C97B3A',
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permission denied');
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return tokenData.data;
}

export function usePushNotifications() {
  const tokenRef = useRef<string | null>(null);
  const notifListener = useRef<Notifications.EventSubscription>();
  const responseListener = useRef<Notifications.EventSubscription>();

  useEffect(() => {
    let mounted = true;

    registerForPushNotifications().then(async (token) => {
      if (!token || !mounted) return;
      tokenRef.current = token;

      // Register with our server
      try {
        await customFetch('/api/push-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, platform: Platform.OS }),
        });
        console.log('[Push] Token registered:', token.slice(0, 40) + '…');
      } catch (err) {
        console.warn('[Push] Failed to register token:', err);
      }
    });

    // Foreground notification received
    notifListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[Push] Notification received:', notification.request.content.title);
      },
    );

    // User tapped a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as {
          relationId?: number;
        };
        console.log('[Push] Notification tapped, relationId:', data?.relationId);
        // Navigation is handled in _layout.tsx via the notification response listener
      },
    );

    return () => {
      mounted = false;
      notifListener.current?.remove();
      responseListener.current?.remove();

      // Unregister token on unmount (sign-out clears the auth so this fires)
      if (tokenRef.current) {
        customFetch('/api/push-token', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokenRef.current }),
        }).catch(() => {});
      }
    };
  }, []);
}
