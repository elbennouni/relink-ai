/**
 * SuggestRepliesPopup — inline panel above the keyboard/input bar.
 * Compact version of SuggestRepliesSheet, intended to be embedded in the
 * conversation screen as an animated bottom panel (not a full-screen modal).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, Share,
  Animated, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/expo';
import { fetch } from 'expo/fetch';

const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';
const PANEL_HEIGHT = 360;

type Suggestion = { text: string; label: string; score: number; scoreLabel: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  relationId: number;
  contactName: string;
  waConnected: boolean;
  onPasteToAgent?: (text: string) => void;
};

export function SuggestRepliesPopup({
  visible, onClose, relationId, contactName, waConnected, onPasteToAgent,
}: Props) {
  const colors = useColors();
  const { getToken } = useAuth();
  const slideAnim = useRef(new Animated.Value(PANEL_HEIGHT)).current;

  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Animate in/out
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : PANEL_HEIGHT,
      useNativeDriver: true,
      friction: 24,
      tension: 200,
    }).start();

    if (visible && !hasLoaded) {
      generate();
      setHasLoaded(true);
    }
    if (!visible) {
      setSuggestions([]);
      setHasLoaded(false);
      setError(null);
    }
  }, [visible]);

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

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSent(null);
    try {
      const res = await apiFetch(`/api/relations/${relationId}/suggest-replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } catch {
      setError('Impossible de générer. Réessaie.');
    } finally {
      setLoading(false);
    }
  }, [relationId, intent, apiFetch]);

  const handleSend = async (text: string, i: number) => {
    setSending(i);
    setError(null);
    try {
      const res = await apiFetch(`/api/relations/${relationId}/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSent(i);
      setTimeout(() => { setSent(null); onClose(); }, 1200);
    } catch (e: any) {
      setError(`Échec : ${e?.message ?? 'erreur'}`);
    } finally {
      setSending(null);
    }
  };

  const scoreColor = (score: number) =>
    score >= 70 ? '#10B981' : score >= 45 ? '#F59E0B' : '#EF4444';

  if (!visible && slideAnim.__getValue() >= PANEL_HEIGHT) return null;

  return (
    <Animated.View
      style={[
        styles.panel,
        {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Feather name="zap" size={14} color={colors.accent} />
            <Text style={[styles.title, { color: colors.foreground }]}>Suggestions IA</Text>
            <View style={[styles.waBadge, { backgroundColor: waConnected ? '#D1FAE5' : '#FEF3C7' }]}>
              <Text style={[styles.waBadgeText, { color: waConnected ? '#065F46' : '#92400E' }]}>
                {waConnected ? 'WA ✓' : 'WA ✗'}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Intent + generate */}
      <View style={[styles.intentRow, { borderBottomColor: colors.border }]}>
        <TextInput
          style={[styles.intentInput, { color: colors.foreground, backgroundColor: colors.muted, fontFamily: 'Inter_400Regular' }]}
          placeholder="Ce que tu veux dire (optionnel)…"
          placeholderTextColor={colors.mutedForeground}
          value={intent}
          onChangeText={setIntent}
          returnKeyType="done"
          onSubmitEditing={generate}
          maxLength={200}
        />
        <TouchableOpacity
          style={[styles.regenBtn, { backgroundColor: colors.primary }]}
          onPress={generate}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator size="small" color={colors.primaryForeground} />
            : <Feather name={suggestions.length > 0 ? 'refresh-cw' : 'zap'} size={16} color={colors.primaryForeground} />
          }
        </TouchableOpacity>
      </View>

      {/* Suggestions list */}
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!!error && (
          <Text style={styles.errorText}>{error}</Text>
        )}
        {loading && suggestions.length === 0 && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Génération en cours…</Text>
          </View>
        )}
        {suggestions.map((s, i) => (
          <View
            key={i}
            style={[styles.card, { borderBottomColor: colors.border }]}
          >
            {/* Label + Score */}
            <View style={styles.cardHeader}>
              <View style={[styles.labelPill, { backgroundColor: colors.accent + '20' }]}>
                <Text style={[styles.labelText, { color: colors.accent }]}>{s.label}</Text>
              </View>
              <View style={styles.scoreWrap}>
                {/* Score bar */}
                <View style={[styles.scoreTrack, { backgroundColor: colors.border }]}>
                  <View style={[styles.scoreBar, { width: `${s.score}%`, backgroundColor: scoreColor(s.score) }]} />
                </View>
                <Text style={[styles.scoreNum, { color: scoreColor(s.score) }]}>{s.score}</Text>
                <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>{s.scoreLabel}</Text>
              </View>
            </View>

            {/* Text */}
            <Text style={[styles.cardText, { color: colors.foreground }]}>{s.text}</Text>

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  { backgroundColor: sent === i ? '#059669' : waConnected ? colors.primary : colors.muted },
                ]}
                onPress={() => handleSend(s.text, i)}
                disabled={!waConnected || sending === i}
                activeOpacity={0.85}
              >
                {sending === i
                  ? <ActivityIndicator size="small" color="#fff" />
                  : sent === i
                    ? <Feather name="check" size={13} color="#fff" />
                    : <Feather name="send" size={13} color={waConnected ? colors.primaryForeground : colors.mutedForeground} />
                }
                <Text style={[styles.sendBtnText, { color: waConnected || sent === i ? '#fff' : colors.mutedForeground }]}>
                  {sent === i ? 'Envoyé !' : 'WhatsApp'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.muted }]}
                onPress={() => Share.share({ message: s.text })}
                activeOpacity={0.8}
              >
                <Feather name="copy" size={14} color={colors.foreground} />
              </TouchableOpacity>

              {onPasteToAgent && (
                <TouchableOpacity
                  style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.muted }]}
                  onPress={() => { onPasteToAgent(s.text); onClose(); }}
                  activeOpacity={0.8}
                >
                  <Feather name="corner-down-right" size={14} color={colors.foreground} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
        <View style={{ height: 8 }} />
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    height: PANEL_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 10 },
      android: { elevation: 10 },
    }),
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  handle: {
    width: 32, height: 3, borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  waBadge: {
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 20,
  },
  waBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  intentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  intentInput: {
    flex: 1,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    height: 36,
  },
  regenBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { flex: 1 },
  loadingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 20, justifyContent: 'center',
  },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  errorText: {
    fontSize: 12, color: '#EF4444', textAlign: 'center',
    fontFamily: 'Inter_400Regular', padding: 10,
  },
  card: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 7,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  labelPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, alignSelf: 'flex-start',
  },
  labelText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  scoreWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, justifyContent: 'flex-end' },
  scoreTrack: { width: 52, height: 4, borderRadius: 2, overflow: 'hidden' },
  scoreBar: { height: 4, borderRadius: 2 },
  scoreNum: { fontSize: 11, fontFamily: 'Inter_700Bold', minWidth: 22, textAlign: 'right' },
  scoreLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  cardText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  sendBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 7, borderRadius: 8,
  },
  sendBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
