import React, { useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, useColorScheme,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSignIn, useSSO } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import colors from '@/constants/colors';

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);
}

export default function SignInScreen() {
  useWarmUpBrowser();

  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;

  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const router = useRouter();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [verifyCode, setVerifyCode] = React.useState('');
  const [ssoLoading, setSsoLoading] = React.useState(false);

  const handleSignIn = async () => {
    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) {
      console.error('Sign-in error:', JSON.stringify(error, null, 2));
      return;
    }
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl('/');
          if (url.startsWith('http')) {
            router.replace('/(tabs)');
          } else {
            router.replace('/(tabs)');
          }
        },
      });
    } else if (signIn.status === 'needs_client_trust') {
      await signIn.mfa.sendEmailCode();
    }
  };

  const handleVerify = async () => {
    await signIn.mfa.verifyEmailCode({ code: verifyCode });
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: () => router.replace('/(tabs)'),
      });
    }
  };

  const [ssoError, setSsoError] = React.useState('');

  const handleGoogle = useCallback(async () => {
    try {
      setSsoLoading(true);
      setSsoError('');
      // AuthSession.makeRedirectUri() produces the canonical native redirect URL
      // that Clerk expects for standalone Expo apps.
      const redirectUrl = AuthSession.makeRedirectUri({ scheme: 'relink-mobile', path: 'oauth-native-callback' });
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl,
      });
      if (createdSessionId) {
        await setActive!({
          session: createdSessionId,
          navigate: async () => {
            router.replace('/(tabs)');
          },
        });
      } else {
        setSsoError('Connexion Google annulée.');
      }
    } catch (err: any) {
      console.error('Google SSO error:', err);
      setSsoError(err?.message ?? 'Erreur lors de la connexion Google.');
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow, router]);

  const s = makeStyles(c);

  if (signIn.status === 'needs_client_trust') {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.card}>
          <Text style={s.title}>Vérification</Text>
          <Text style={s.subtitle}>Entrez le code reçu par email</Text>
          <TextInput
            style={s.input}
            value={verifyCode}
            onChangeText={setVerifyCode}
            placeholder="Code de vérification"
            placeholderTextColor={c.mutedForeground}
            keyboardType="numeric"
            autoFocus
          />
          {errors.fields.code && <Text style={s.error}>{errors.fields.code.message}</Text>}
          <Pressable
            style={[s.btn, fetchStatus === 'fetching' && s.btnDisabled]}
            onPress={handleVerify}
            disabled={fetchStatus === 'fetching'}
          >
            {fetchStatus === 'fetching'
              ? <ActivityIndicator color={c.primaryForeground} />
              : <Text style={s.btnText}>Vérifier</Text>}
          </Pressable>
          <Pressable onPress={() => signIn.mfa.sendEmailCode()}>
            <Text style={s.link}>Renvoyer le code</Text>
          </Pressable>
          <Pressable onPress={() => signIn.reset()}>
            <Text style={[s.link, { marginTop: 8 }]}>Recommencer</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text style={s.logo}>ReLink AI</Text>
          <Text style={s.tagline}>Analysez vos relations</Text>
        </View>

        <View style={s.card}>
          <Text style={s.title}>Connexion</Text>

          {/* Google */}
          <Pressable style={s.googleBtn} onPress={handleGoogle} disabled={ssoLoading}>
            {ssoLoading
              ? <ActivityIndicator color={c.foreground} />
              : <Text style={s.googleBtnText}>Continuer avec Google</Text>}
          </Pressable>
          {!!ssoError && <Text style={s.error}>{ssoError}</Text>}

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>ou</Text>
            <View style={s.dividerLine} />
          </View>

          {/* Email / password */}
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="votre@email.com"
            placeholderTextColor={c.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {errors.fields.identifier && (
            <Text style={s.error}>{errors.fields.identifier.message}</Text>
          )}

          <Text style={s.label}>Mot de passe</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={c.mutedForeground}
            secureTextEntry
          />
          {errors.fields.password && (
            <Text style={s.error}>{errors.fields.password.message}</Text>
          )}

          <Pressable
            style={[s.btn, (!email || !password || fetchStatus === 'fetching') && s.btnDisabled]}
            onPress={handleSignIn}
            disabled={!email || !password || fetchStatus === 'fetching'}
          >
            {fetchStatus === 'fetching'
              ? <ActivityIndicator color={c.primaryForeground} />
              : <Text style={s.btnText}>Se connecter</Text>}
          </Pressable>

          <View style={s.footerRow}>
            <Text style={s.footerText}>Pas encore de compte ? </Text>
            <Link href="/sign-up">
              <Text style={s.link}>Créer un compte</Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: typeof colors.light) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    header: { alignItems: 'center', marginBottom: 32 },
    logo: { fontFamily: 'Inter_700Bold', fontSize: 28, color: c.foreground, letterSpacing: -0.5 },
    tagline: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.mutedForeground, marginTop: 4 },
    card: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 24,
      borderWidth: 1,
      borderColor: c.border,
    },
    title: { fontFamily: 'Inter_600SemiBold', fontSize: 20, color: c.foreground, marginBottom: 20 },
    label: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.mutedForeground, marginBottom: 6, marginTop: 12 },
    input: {
      backgroundColor: c.background,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: c.foreground,
    },
    error: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.destructive, marginTop: 4 },
    btn: {
      backgroundColor: c.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 20,
    },
    btnDisabled: { opacity: 0.45 },
    btnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.primaryForeground },
    googleBtn: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: 'center',
    },
    googleBtnText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: c.foreground },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
    dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
    dividerText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.mutedForeground, marginHorizontal: 12 },
    footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' },
    footerText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.mutedForeground },
    link: { fontFamily: 'Inter_500Medium', fontSize: 14, color: c.accent },
    subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.mutedForeground, marginBottom: 16 },
  });
}
