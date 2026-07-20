import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetRelation } from '@workspace/api-client-react';
import { useAuth } from '@clerk/expo';
import { fetch } from 'expo/fetch';

const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

type Session = { id: number; startedAt: string; endedAt: string | null; isActive: boolean };
type Stats = { totalSessions: number; bestSeconds: number; urgesResisted: number; panics: number; resets: number };

function pad(n: number) { return String(n).padStart(2, '0'); }
function formatDuration(s: number) {
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

export default function NoContactScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationId = Number(id);
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const other = relation?.participantOther ?? '…';

  const [session, setSession] = useState<Session | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [urgeLogged, setUrgeLogged] = useState(false);
  const [mode, setMode] = useState<'idle' | 'panic'>('idle');
  const [panicText, setPanicText] = useState('');
  const [isPanicking, setIsPanicking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const apiFetch = useCallback(async (path: string, opts: RequestInit = {}) => {
    const token = await getToken();
    return fetch(`https://${domain}${path}`, {
      ...opts,
      headers: {
        ...(opts.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    } as any);
  }, [getToken]);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/relations/${relationId}/no-contact`);
      const data = await res.json();
      setSession(data.active);
      setStats(data.stats);
    } catch {}
    finally { setLoading(false); }
  }, [relationId, apiFetch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Live counter
  useEffect(() => {
    if (!session?.isActive) return;
    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000)));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [session]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleStart = async () => {
    try {
      const res = await apiFetch(`/api/relations/${relationId}/no-contact/start`, { method: 'POST' });
      const data = await res.json();
      setSession(data);
      setStats((p) => p ? { ...p, totalSessions: p.totalSessions + 1 } : p);
    } catch { Alert.alert('Erreur', 'Impossible de démarrer.'); }
  };

  const handleReset = () => {
    Alert.alert(
      'Remettre à zéro ?',
      'Le compteur sera remis à zéro. Chaque jour est une nouvelle chance.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Remettre à zéro', style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/relations/${relationId}/no-contact/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: 'Reset manuel' }),
              });
              const data = await res.json();
              setSession(data);
              setStats((p) => p ? { ...p, resets: p.resets + 1, totalSessions: p.totalSessions + 1 } : p);
            } catch { Alert.alert('Erreur', 'Impossible de réinitialiser.'); }
          },
        },
      ]
    );
  };

  const handleUrge = async () => {
    try {
      await apiFetch(`/api/relations/${relationId}/no-contact/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'urge' }),
      });
      setStats((p) => p ? { ...p, urgesResisted: p.urgesResisted + 1 } : p);
      setUrgeLogged(true);
      setTimeout(() => setUrgeLogged(false), 3000);
    } catch {}
  };

  const handlePanic = async () => {
    setMode('panic');
    setPanicText('');
    setIsPanicking(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = await getToken();
      const res = await fetch(`https://${domain}/api/relations/${relationId}/no-contact/panic-support`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      } as any);

      if (!res.ok || !res.body) throw new Error();
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.content) setPanicText((p) => p + parsed.content);
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError' && !panicText) {
        setPanicText("Je suis là. Respire. Tu as tenu jusqu'ici — tu peux tenir encore.");
      }
    } finally {
      setIsPanicking(false);
    }
  };

  const { d, h, m, s } = formatDuration(elapsed);
  const bestDays = stats ? Math.floor(stats.bestSeconds / 86400) : 0;
  const topPad = insets.top + 8;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>No Contact</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{other}</Text>
        </View>
      </View>

      <View style={styles.body}>

        {/* Title */}
        <View style={styles.titleSection}>
          <View style={[styles.shieldBadge, { backgroundColor: colors.muted }]}>
            <Feather name="shield-off" size={18} color={colors.accent} />
          </View>
          <Text style={[styles.mainTitle, { color: colors.foreground }]}>
            {session?.isActive ? 'Tu tiens bon.' : 'Reprends le contrôle.'}
          </Text>
          <Text style={[styles.mainSub, { color: colors.mutedForeground }]}>
            {session?.isActive
              ? `Sans contact avec ${other}`
              : `Commence ton No Contact avec ${other}`}
          </Text>
        </View>

        {/* Timer */}
        {session?.isActive && (
          <View style={[styles.timerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.timerRow}>
              {d > 0 && (
                <View style={styles.timerUnit}>
                  <Text style={[styles.timerNum, { color: colors.foreground }]}>{d}</Text>
                  <Text style={[styles.timerLabel, { color: colors.mutedForeground }]}>j</Text>
                </View>
              )}
              <View style={styles.timerUnit}>
                <Text style={[styles.timerNum, { color: colors.foreground }]}>{pad(h)}</Text>
                <Text style={[styles.timerLabel, { color: colors.mutedForeground }]}>h</Text>
              </View>
              <Text style={[styles.timerSep, { color: colors.mutedForeground }]}>:</Text>
              <View style={styles.timerUnit}>
                <Text style={[styles.timerNum, { color: colors.foreground }]}>{pad(m)}</Text>
                <Text style={[styles.timerLabel, { color: colors.mutedForeground }]}>min</Text>
              </View>
              <Text style={[styles.timerSep, { color: colors.mutedForeground }]}>:</Text>
              <View style={styles.timerUnit}>
                <Text style={[styles.timerNum, { color: colors.foreground }]}>{pad(s)}</Text>
                <Text style={[styles.timerLabel, { color: colors.mutedForeground }]}>sec</Text>
              </View>
            </View>
          </View>
        )}

        {/* Stats */}
        {stats && (
          <View style={styles.statsRow}>
            {[
              { icon: 'trophy', value: `${bestDays}j`, label: 'Record' },
              { icon: 'heart', value: String(stats.urgesResisted), label: 'Envies résistées' },
              { icon: 'refresh-cw', value: String(stats.resets), label: 'Rechutes' },
            ].map((item) => (
              <View key={item.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name={item.icon as any} size={16} color={colors.accent} />
                <Text style={[styles.statValue, { color: colors.foreground }]}>{item.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Action buttons */}
        {!session?.isActive ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleStart}
            activeOpacity={0.85}
          >
            <Feather name="shield" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Démarrer le No Contact</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.actionsGrid}>
            {/* J'ai résisté */}
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: urgeLogged ? '#D1FAE5' : colors.card, borderColor: urgeLogged ? '#A7F3D0' : colors.border }]}
              onPress={handleUrge}
              activeOpacity={0.8}
            >
              <Feather name="heart" size={22} color={urgeLogged ? '#059669' : colors.accent} />
              <Text style={[styles.actionCardTitle, { color: urgeLogged ? '#065F46' : colors.foreground }]}>
                {urgeLogged ? 'Bravo ! 💪' : "J'ai résisté"}
              </Text>
              <Text style={[styles.actionCardSub, { color: colors.mutedForeground }]}>Envie résistée</Text>
            </TouchableOpacity>

            {/* SOS Rechute */}
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setMode('panic')}
              activeOpacity={0.8}
            >
              <Feather name="zap" size={22} color="#F59E0B" />
              <Text style={[styles.actionCardTitle, { color: colors.foreground }]}>SOS</Text>
              <Text style={[styles.actionCardSub, { color: colors.mutedForeground }]}>Support IA</Text>
            </TouchableOpacity>

            {/* Reset */}
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleReset}
              activeOpacity={0.8}
            >
              <Feather name="refresh-cw" size={22} color="#EF4444" />
              <Text style={[styles.actionCardTitle, { color: colors.foreground }]}>Réinitialiser</Text>
              <Text style={[styles.actionCardSub, { color: colors.mutedForeground }]}>Rechute</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Panic mode */}
        {mode === 'panic' && (
          <View style={[styles.panicCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.panicHeader}>
              <Text style={[styles.panicTitle, { color: colors.foreground }]}>🆘 Support</Text>
              <TouchableOpacity onPress={() => { setMode('idle'); abortRef.current?.abort(); }}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {!panicText && !isPanicking ? (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={handlePanic}
                activeOpacity={0.85}
              >
                <Feather name="zap" size={16} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Demander du soutien à l'IA</Text>
              </TouchableOpacity>
            ) : (
              <>
                {isPanicking && !panicText && <ActivityIndicator color={colors.accent} />}
                {!!panicText && (
                  <Text style={[styles.panicText, { color: colors.foreground }]}>{panicText}</Text>
                )}
                {isPanicking && !!panicText && (
                  <Text style={{ color: colors.accent, fontFamily: 'Inter_400Regular' }}>▊</Text>
                )}
              </>
            )}
          </View>
        )}

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  content: { flexGrow: 1 },
  body: { padding: 20, gap: 20 },
  titleSection: { alignItems: 'center', gap: 8 },
  shieldBadge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  mainTitle: { fontSize: 22, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  mainSub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  timerCard: {
    borderRadius: 20, padding: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center',
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timerUnit: { alignItems: 'center', minWidth: 52 },
  timerNum: { fontSize: 44, fontFamily: 'Inter_700Bold', lineHeight: 52 },
  timerLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  timerSep: { fontSize: 36, fontFamily: 'Inter_700Bold', marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, borderRadius: 14, padding: 12, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', gap: 4,
  },
  statValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 15, borderRadius: 14,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  actionsGrid: { flexDirection: 'row', gap: 10 },
  actionCard: {
    flex: 1, borderRadius: 14, padding: 16, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', gap: 6,
  },
  actionCardTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  actionCardSub: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  panicCard: {
    borderRadius: 16, padding: 18, borderWidth: StyleSheet.hairlineWidth, gap: 14,
  },
  panicHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panicTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  panicText: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 23 },
});
