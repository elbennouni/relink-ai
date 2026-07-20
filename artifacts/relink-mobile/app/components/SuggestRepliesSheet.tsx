import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, Share, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/expo';
import { fetch } from 'expo/fetch';

const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

type Suggestion = { text: string; label: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  relationId: number;
  contactName: string;
  waConnected: boolean;
  onPasteToAgent?: (text: string) => void;
};

export function SuggestRepliesSheet({ visible, onClose, relationId, contactName, waConnected, onPasteToAgent }: Props) {
  const colors = useColors();
  const { getToken } = useAuth();

  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [context, setContext] = useState<{ sender: string; content: string; isMe: boolean }[]>([]);
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setContext(data.context ?? []);
    } catch {
      setError('Impossible de générer des suggestions. Réessaie.');
    } finally {
      setLoading(false);
    }
  }, [relationId, intent, apiFetch]);

  // Auto-generate on open
  useEffect(() => {
    if (visible && suggestions.length === 0 && !loading) generate();
  }, [visible]);

  const handleSend = async (text: string, i: number) => {
    setSending(i);
    setError(null);
    try {
      const res = await apiFetch(`/api/relations/${relationId}/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `HTTP ${res.status}`);
      }
      setSent(i);
      setTimeout(() => { setSent(null); onClose(); }, 1200);
    } catch (e: any) {
      setError(`Envoi échoué : ${e?.message ?? 'erreur'}`);
    } finally {
      setSending(null);
    }
  };

  const handleShare = async (text: string) => {
    await Share.share({ message: text });
  };

  const handleClose = () => {
    setSuggestions([]);
    setContext([]);
    setIntent('');
    setError(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Handle + header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Feather name="zap" size={16} color={colors.accent} />
              <Text style={[styles.title, { color: colors.foreground }]}>Générer une réponse</Text>
            </View>
            <TouchableOpacity onPress={handleClose} activeOpacity={0.7}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <View style={styles.recipientRow}>
            <Feather name="smartphone" size={12} color={colors.mutedForeground} />
            <Text style={[styles.recipientText, { color: colors.mutedForeground }]}>
              Envoi à{' '}
              <Text style={[styles.recipientName, { color: colors.foreground }]}>{contactName}</Text>
              {'  '}
              <Text style={[
                styles.waBadge,
                { color: waConnected ? '#065F46' : '#92400E' },
              ]}>
                {waConnected ? '● WhatsApp connecté' : '⚠ WhatsApp non connecté'}
              </Text>
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Contexte récent */}
          {context.length > 0 && (
            <View style={[styles.contextBox, { backgroundColor: colors.muted }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Contexte récent</Text>
              {context.map((msg, i) => (
                <View key={i} style={[styles.contextMsgRow, { justifyContent: msg.isMe ? 'flex-end' : 'flex-start' }]}>
                  <Text style={[
                    styles.contextBubble,
                    {
                      backgroundColor: msg.isMe ? colors.primary : colors.card,
                      color: msg.isMe ? colors.primaryForeground : colors.foreground,
                      borderColor: colors.border,
                    },
                  ]}>
                    {msg.content.startsWith('[Vocal]') ? '🎤 ' + msg.content.replace('[Vocal] ', '') : msg.content}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Intent input */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Ce que tu veux exprimer{' '}
              <Text style={{ fontFamily: 'Inter_400Regular', textTransform: 'none', letterSpacing: 0 }}>(optionnel)</Text>
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              placeholder={`Ex : dire à ${contactName} que je suis occupé…`}
              placeholderTextColor={colors.mutedForeground}
              value={intent}
              onChangeText={setIntent}
              multiline
              maxLength={500}
            />
          </View>

          {/* Generate button */}
          <TouchableOpacity
            style={[
              styles.generateBtn,
              { backgroundColor: suggestions.length > 0 ? colors.muted : colors.primary, borderColor: colors.border },
            ]}
            onPress={generate}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <><ActivityIndicator size="small" color={suggestions.length > 0 ? colors.foreground : colors.primaryForeground} /><Text style={[styles.generateBtnText, { color: suggestions.length > 0 ? colors.foreground : colors.primaryForeground }]}>Génération…</Text></>
            ) : suggestions.length > 0 ? (
              <><Feather name="refresh-cw" size={15} color={colors.foreground} /><Text style={[styles.generateBtnText, { color: colors.foreground }]}>Regénérer</Text></>
            ) : (
              <><Feather name="zap" size={15} color={colors.primaryForeground} /><Text style={[styles.generateBtnText, { color: colors.primaryForeground }]}>Générer des suggestions</Text></>
            )}
          </TouchableOpacity>

          {!!error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                Suggestions — calquées sur ton style
              </Text>
              {suggestions.map((s, i) => (
                <View key={i} style={[styles.suggestionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.labelPill, { backgroundColor: colors.accent + '20' }]}>
                    <Text style={[styles.labelPillText, { color: colors.accent }]}>{s.label}</Text>
                  </View>
                  <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s.text}</Text>

                  <View style={styles.suggestionActions}>
                    {/* Send via WhatsApp */}
                    <TouchableOpacity
                      style={[
                        styles.sendBtn,
                        {
                          backgroundColor: sent === i ? '#059669' : waConnected ? colors.primary : colors.muted,
                          flex: 1,
                        },
                      ]}
                      onPress={() => handleSend(s.text, i)}
                      disabled={!waConnected || sending === i}
                      activeOpacity={0.85}
                    >
                      {sending === i
                        ? <ActivityIndicator size="small" color="#fff" />
                        : sent === i
                          ? <Feather name="check" size={14} color="#fff" />
                          : <Feather name="send" size={14} color={waConnected ? colors.primaryForeground : colors.mutedForeground} />
                      }
                      <Text style={[styles.sendBtnText, { color: waConnected || sent === i ? '#fff' : colors.mutedForeground }]}>
                        {sent === i ? 'Envoyé !' : 'Envoyer sur WhatsApp'}
                      </Text>
                    </TouchableOpacity>

                    {/* Share/Copy */}
                    <TouchableOpacity
                      style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.muted }]}
                      onPress={() => handleShare(s.text)}
                      activeOpacity={0.8}
                    >
                      <Feather name="share" size={16} color={colors.foreground} />
                    </TouchableOpacity>

                    {/* Paste to agent */}
                    {onPasteToAgent && (
                      <TouchableOpacity
                        style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.muted }]}
                        onPress={() => { onPasteToAgent(s.text); handleClose(); }}
                        activeOpacity={0.8}
                      >
                        <Feather name="corner-down-right" size={16} color={colors.foreground} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 12, paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recipientText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  recipientName: { fontFamily: 'Inter_600SemiBold' },
  waBadge: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 60 },
  contextBox: {
    borderRadius: 14, padding: 14, gap: 8,
  },
  contextMsgRow: { flexDirection: 'row' },
  contextBubble: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 14, maxWidth: '80%',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  section: { gap: 10 },
  sectionLabel: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, minHeight: 70,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 12,
  },
  generateBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  errorText: { fontSize: 13, color: '#EF4444', textAlign: 'center', fontFamily: 'Inter_400Regular' },
  suggestionCard: {
    borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  labelPill: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  labelPillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  suggestionText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  suggestionActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 10,
  },
  sendBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  iconBtn: {
    width: 38, height: 38, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
