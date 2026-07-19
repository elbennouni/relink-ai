import * as WebBrowser from 'expo-web-browser';

/**
 * This screen is the redirect target after a Google / SSO OAuth flow on Android.
 * It MUST call maybeCompleteAuthSession() so the Chrome Custom Tab closes and
 * hands control back to startSSOFlow(), which then receives createdSessionId.
 *
 * The redirect URL used in sign-in.tsx points here:
 *   Linking.createURL('/oauth-native-callback')  →  relink-mobile:///oauth-native-callback
 *
 * Expo Router renders this screen for a split-second before the root layout's
 * auth guard redirects the (now-authenticated) user to /(tabs).
 */
WebBrowser.maybeCompleteAuthSession();

export default function OAuthNativeCallback() {
  return null;
}
