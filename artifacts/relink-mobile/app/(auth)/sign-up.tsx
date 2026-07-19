import React from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, useColorScheme,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSignUp } from '@clerk/expo';
import colors from '@/constants/colors';

export default function SignUpScreen() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;

  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');

  const handleSignUp = async () => {
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) {
      console.error('Sign-up error:', JSON.stringify(error, null, 2));
      return;
    }
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: () => router.replace('/(tabs)'),
      });
    }
  };

  const s = makeStyles(c);

  if (
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0
  ) {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.scroll}>
          <View style={s.card}>
            <Text style={s.title}>Vérifiez votre email</Text>
            <Text style={s.subtitle}>Un code a été envoyé à {email}</Text>
            <TextInput
              style={s.input}
              value={code}
              onChangeText={setCode}
              placeholder="Code de vérification"
              placeholderTextColor={c.mutedForeground}
              keyboardType="numeric"
              autoComplete="one-time-code"
              autoFocus
            />
            {errors.fields.code && <Text style={s.error}>{errors.fields.code.message}</Text>}
            <Pressable
              style={[s.btn, (fetchStatus === 'fetching' || !code) && s.btnDisabled]}
              onPress={handleVerify}
              disabled={fetchStatus === 'fetching' || !code}
            >
              {fetchStatus === 'fetching'
                ? <ActivityIndicator color={c.primaryForeground} />
                : <Text style={s.btnText}>Vérifier</Text>}
            </Pressable>
            <Pressable onPress={() => signUp.verifications.sendEmailCode()}>
              <Text style={[s.link, { textAlign: 'center', marginTop: 12 }]}>Renvoyer le code</Text>
            </Pressable>
          </View>

          {/* Required for Clerk bot protection */}
          <View nativeID="clerk-captcha" />
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
          <Text style={s.title}>Créer un compte</Text>

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
            autoComplete="email"
            textContentType="emailAddress"
          />
          {errors.fields.emailAddress && (
            <Text style={s.error}>{errors.fields.emailAddress.message}</Text>
          )}

          <Text style={s.label}>Mot de passe</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="8 caractères minimum"
            placeholderTextColor={c.mutedForeground}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
          />
          {errors.fields.password && (
            <Text style={s.error}>{errors.fields.password.message}</Text>
          )}

          <Pressable
            style={[s.btn, (!email || !password || fetchStatus === 'fetching') && s.btnDisabled]}
            onPress={handleSignUp}
            disabled={!email || !password || fetchStatus === 'fetching'}
          >
            {fetchStatus === 'fetching'
              ? <ActivityIndicator color={c.primaryForeground} />
              : <Text style={s.btnText}>Créer mon compte</Text>}
          </Pressable>

          <View style={s.footerRow}>
            <Text style={s.footerText}>Déjà un compte ? </Text>
            <Link href="/sign-in">
              <Text style={s.link}>Se connecter</Text>
            </Link>
          </View>
        </View>

        {/* Required for Clerk bot protection */}
        <View nativeID="clerk-captcha" />
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
    title: { fontFamily: 'Inter_600SemiBold', fontSize: 20, color: c.foreground, marginBottom: 4 },
    subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.mutedForeground, marginBottom: 16 },
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
    footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' },
    footerText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.mutedForeground },
    link: { fontFamily: 'Inter_500Medium', fontSize: 14, color: c.accent },
  });
}
