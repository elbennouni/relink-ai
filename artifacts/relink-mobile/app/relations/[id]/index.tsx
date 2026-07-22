import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, RefreshControl, TextInput,
  KeyboardAvoidingView, Keyboard, Share, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetRelation, useListMessages } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@clerk/expo';
import { PowerBalanceBar } from '@/app/components/PowerBalanceBar';
import { SuggestRepliesPopup } from '@/app/components/SuggestRepliesPopup';

const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

type Msg = {
  id: number;
  sender: string;
  content: string;
  isMe: boolean;
  sentAt: string;
  importSource: string;
  mediaData?: string | null;
};

type Separator = { type: 'separator'; dateLabel: string; dateKey: string; id: string };
type ListItem = Msg | Separator;

function groupWithSeparators(messages: Msg[]): ListItem[] {
  const result: ListItem[] = [];
  let lastDay = '';
  for (const msg of messages) {
    const day = new Date(msg.sentAt).toDateString();
    if (day !== lastDay) {
      result.push({ type: 'separator', dateLabel: formatDay(msg.sentAt), dateKey: day, id: `sep-${day}` });
      lastDay = day;
    }
    result.push(msg);
  }
  return result;
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationId = Number(id);
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const { data: messageData, isLoading, refetch, isRefetching } = useListMessages(relationId, { query: { enabled: !!relationId } });

  // WhatsApp connection status
  const [waConnected, setWaConnected] = useState(false);

  // Lightbox
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  // Suggestions popup
  const [suggestOpen, setSuggestOpen] = useState(false);

  // Message selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // SOS mode
  const [sosActive, setSosActive] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);

  // Input bar
  const [inputText, setInputText] = useState('');
  const [sendingText, setSendingText] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [customTimerVal, setCustomTimerVal] = useState('');
  const [customTimerUnit, setCustomTimerUnit] = useState<'min' | 'h'>('min');
  const [customTimerError, setCustomTimerError] = useState('');
  const inputRef = useRef<TextInput>(null);

  const messages = (messageData?.messages ?? []) as Msg[];
  const grouped = groupWithSeparators(messages);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // apiFetch doit être déclaré EN PREMIER — tous les hooks ci-dessous en dépendent
  const apiFetch = useCallback(async (path: string, opts: RequestInit = {}) => {
    const token = await getToken();
    return fetch(`https://${domain}${path}`, {
      ...opts,
      headers: { ...(opts.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  }, [getToken]);

  // Check WhatsApp + SOS status
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {};
        const [waRes, sosRes] = await Promise.all([
          fetch(`https://${domain}/api/relations/${relationId}/whatsapp/status`, { headers }),
          fetch(`https://${domain}/api/relations/${relationId}/sos/status`, { headers }),
        ]);
        const [waData, sosData] = await Promise.all([waRes.json(), sosRes.json()]);
        setWaConnected(waData.status === 'connected');
        setSosActive(sosData.active ?? false);
      } catch {}
    })();
  }, [relationId, getToken]);

  const toggleSos = useCallback(async () => {
    if (sosLoading) return;
    setSosLoading(true);
    try {
      const res = await apiFetch(`/api/relations/${relationId}/sos/${sosActive ? 'disable' : 'enable'}`, { method: 'POST' });
      const data = await res.json();
      setSosActive(data.active ?? !sosActive);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {}
    finally { setSosLoading(false); }
  }, [sosActive, sosLoading, relationId, apiFetch]);

  // ─── Navigation ───────────────────────────────────────────────────────────

  const handleAgent = useCallback((prefill?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (prefill) {
      router.push({ pathname: `/relations/${relationId}/agent`, params: { prefill } });
    } else {
      router.push(`/relations/${relationId}/agent`);
    }
  }, [relationId, router]);

  // ─── Selection mode ───────────────────────────────────────────────────────

  const enterSelection = useCallback((firstId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectionMode(true);
    setSelectedIds(new Set([firstId]));
    setSuggestOpen(false);
  }, []);

  const toggleSelect = useCallback((msgId: number) => {
    Haptics.selectionAsync();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const selectDay = useCallback((dateKey: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const dayIds = messages
      .filter(m => new Date(m.sentAt).toDateString() === dateKey)
      .map(m => m.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      dayIds.forEach(id => next.add(id));
      return next;
    });
  }, [messages]);

  const cancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectedMessages = messages.filter(m => selectedIds.has(m.id));

  const analyzeSelected = useCallback(() => {
    const sorted = [...selectedMessages].sort(
      (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
    );
    const text = sorted.map(m => `${m.isMe ? 'Moi' : (relation?.participantOther ?? '?')}: ${m.content}`).join('\n');
    cancelSelection();
    handleAgent(`Analyse ces messages sélectionnés :\n\n${text}`);
  }, [selectedMessages, relation, cancelSelection, handleAgent]);

  const exportSelected = useCallback(() => {
    const sorted = [...selectedMessages].sort(
      (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
    );
    const text = sorted
      .map(m => `[${formatTime(m.sentAt)}] ${m.isMe ? 'Moi' : (relation?.participantOther ?? '?')}: ${m.content}`)
      .join('\n');
    Share.share({ message: text });
  }, [selectedMessages, relation]);

  // ─── Input bar ────────────────────────────────────────────────────────────

  const handleSendText = useCallback(async () => {
    const text = inputText.trim();
    if (!text || sendingText) return;
    setSendingText(true);
    setInputText('');
    try {
      if (waConnected) {
        await apiFetch(`/api/relations/${relationId}/whatsapp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
      } else {
        await apiFetch(`/api/relations/${relationId}/messages/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });
      }
      setTimeout(() => refetch(), 600);
    } catch (e) {
      console.warn('[Send]', e);
    } finally {
      setSendingText(false);
    }
  }, [inputText, sendingText, waConnected, relationId, apiFetch, refetch]);

  const handlePickImage = useCallback(async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { setPickingImage(false); return; }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 0.65,
        base64: true,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets?.[0]?.base64) { setPickingImage(false); return; }

      const { base64, mimeType } = result.assets[0];
      const mime = mimeType ?? 'image/jpeg';
      const mediaData = `data:${mime};base64,${base64}`;

      await apiFetch(`/api/relations/${relationId}/messages/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '[Image]', mediaData }),
      });
      setTimeout(() => refetch(), 600);
    } catch (e) {
      console.warn('[ImagePick]', e);
    } finally {
      setPickingImage(false);
    }
  }, [pickingImage, relationId, apiFetch, refetch]);

  const openSuggestions = useCallback(() => {
    Keyboard.dismiss();
    setSuggestOpen(true);
  }, []);

  const handleScheduleSend = useCallback(async (text: string, delayMinutes: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInputText('');
    try {
      await apiFetch(`/api/relations/${relationId}/messages/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed, delayMinutes }),
      });
    } catch (e) {
      console.warn('[Schedule]', e);
      setInputText(trimmed);
    }
  }, [relationId, apiFetch]);

  // ─── Render helpers ───────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ListItem }) => {
    if ('type' in item && item.type === 'separator') {
      const sep = item as Separator;
      return (
        <View style={styles.dayRow}>
          <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            onPress={selectionMode ? () => selectDay(sep.dateKey) : undefined}
            activeOpacity={selectionMode ? 0.6 : 1}
            style={styles.dayLabelWrap}
          >
            <Text style={[styles.dayLabel, { color: colors.mutedForeground, backgroundColor: colors.background }]}>
              {sep.dateLabel}
            </Text>
            {selectionMode && (
              <Text style={[styles.selectDayHint, { color: colors.accent }]}>  Sélectionner</Text>
            )}
          </TouchableOpacity>
          <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
        </View>
      );
    }

    const msg = item as Msg;
    const isImage = !!msg.mediaData && msg.mediaData.startsWith('data:image');
    const isAudio = !!msg.mediaData && msg.mediaData.startsWith('data:audio');
    const isVoiceText = msg.content.startsWith('[Vocal]');
    const isSelected = selectedIds.has(msg.id);

    return (
      <TouchableOpacity
        onPress={selectionMode ? () => toggleSelect(msg.id) : undefined}
        onLongPress={() => { if (!selectionMode) enterSelection(msg.id); }}
        activeOpacity={selectionMode ? 0.7 : 1}
        delayLongPress={350}
      >
        <View style={[
          styles.msgRow,
          msg.isMe ? styles.msgRowMe : styles.msgRowThem,
          isSelected && { backgroundColor: colors.accent + '18' },
        ]}>
          {/* Selection checkbox */}
          {selectionMode && (
            <View style={[styles.checkbox, msg.isMe ? styles.checkboxRight : styles.checkboxLeft]}>
              <Feather
                name={isSelected ? 'check-circle' : 'circle'}
                size={18}
                color={isSelected ? colors.accent : colors.border}
              />
            </View>
          )}

          <View style={[
            styles.bubble,
            msg.isMe
              ? [styles.bubbleMe, { backgroundColor: colors.bubbleMe }]
              : [styles.bubbleThem, { backgroundColor: colors.bubbleThem, borderColor: colors.border }],
          ]}>
            {!msg.isMe && (
              <Text style={[styles.senderName, { color: colors.accent }]}>{msg.sender}</Text>
            )}

            {isImage && (
              <TouchableOpacity
                onPress={() => selectionMode ? toggleSelect(msg.id) : setLightboxUri(msg.mediaData!)}
                activeOpacity={0.9}
              >
                <Image source={{ uri: msg.mediaData! }} style={styles.mediaImage} contentFit="cover" />
              </TouchableOpacity>
            )}

            {(isAudio || isVoiceText) && (
              <View style={[styles.voiceRow, { backgroundColor: msg.isMe ? 'rgba(255,255,255,0.15)' : colors.muted, borderRadius: 10, padding: 8 }]}>
                <Feather name="mic" size={14} color={msg.isMe ? colors.bubbleMeText : colors.accent} />
                <Text style={[styles.voiceLabel, { color: msg.isMe ? colors.bubbleMeText : colors.mutedForeground }]}>Vocal</Text>
              </View>
            )}

            {!!msg.content && !isImage && (
              <Text style={[styles.bubbleText, { color: msg.isMe ? colors.bubbleMeText : colors.bubbleThemText }]}>
                {isVoiceText ? msg.content.replace('[Vocal] ', '') : msg.content}
              </Text>
            )}

            <Text style={[styles.bubbleTime, { color: msg.isMe ? colors.bubbleMeText + 'AA' : colors.mutedForeground }]}>
              {formatTime(msg.sentAt)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Feather name="message-circle" size={36} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Aucun message importé</Text>
      <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
        Importez une conversation WhatsApp ou connectez votre compte.
      </Text>
      <TouchableOpacity
        style={[styles.emptyButton, { backgroundColor: colors.primary }]}
        onPress={() => router.push(`/relations/${relationId}/import`)}
        activeOpacity={0.85}
      >
        <Text style={[styles.emptyButtonText, { color: colors.primaryForeground }]}>Importer des messages</Text>
      </TouchableOpacity>
    </View>
  );

  // ─── Layout ───────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {relation?.name ?? '...'}
          </Text>
          {relation?.currentPhase && (
            <Text style={[styles.headerPhase, { color: colors.accent }]} numberOfLines={1}>
              {relation.currentPhase}
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => router.push(`/relations/${relationId}/whatsapp`)} style={styles.iconBtn} activeOpacity={0.7}>
            <View style={styles.iconBtnWrap}>
              <Feather name="smartphone" size={20} color={colors.foreground} />
              <View style={[styles.statusDot, { backgroundColor: waConnected ? '#10B981' : '#9CA3AF' }]} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/relations/${relationId}/no-contact`)} style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="shield-off" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/relations/${relationId}/memory`)} style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="cpu" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/relations/${relationId}/import`)} style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="upload" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Power Balance Bar */}
      {messages.length >= 5 && (
        <PowerBalanceBar
          relationId={relationId}
          contactName={relation?.participantOther ?? relation?.name ?? '…'}
        />
      )}

      {/* Messages */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => (item as any).id?.toString() ?? (item as any).id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 12 },
            !messages.length && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!messages.length}
          onScrollBeginDrag={() => { if (suggestOpen) setSuggestOpen(false); }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />
          }
        />
      )}

      {/* Suggestions popup — sits between list and input bar */}
      <SuggestRepliesPopup
        visible={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        relationId={relationId}
        contactName={relation?.participantOther ?? '…'}
        waConnected={waConnected}
        onPasteToAgent={(text) => {
          setSuggestOpen(false);
          handleAgent(text);
        }}
      />

      {/* Bottom bar — input OR selection actions */}
      {selectionMode ? (
        /* Selection action bar */
        <View style={[styles.selectionBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: bottomPad + 4 }]}>
          <Text style={[styles.selectionCount, { color: colors.foreground }]}>
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''}
          </Text>
          <View style={styles.selectionActions}>
            <TouchableOpacity
              style={[styles.selActionBtn, { backgroundColor: colors.primary }]}
              onPress={analyzeSelected}
              disabled={selectedIds.size === 0}
              activeOpacity={0.85}
            >
              <Feather name="zap" size={14} color={colors.primaryForeground} />
              <Text style={[styles.selActionText, { color: colors.primaryForeground }]}>Analyser IA</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selActionBtn, { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }]}
              onPress={exportSelected}
              disabled={selectedIds.size === 0}
              activeOpacity={0.85}
            >
              <Feather name="share" size={14} color={colors.foreground} />
              <Text style={[styles.selActionText, { color: colors.foreground }]}>Exporter</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selCancelBtn, { borderColor: colors.border }]}
              onPress={cancelSelection}
              activeOpacity={0.7}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* Input bar */
        <View style={[styles.inputBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: bottomPad + 4 }]}>
          {/* Image picker */}
          <TouchableOpacity
            style={[styles.inputIconBtn, { backgroundColor: colors.muted }]}
            onPress={handlePickImage}
            disabled={pickingImage}
            activeOpacity={0.7}
          >
            {pickingImage
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Feather name="image" size={20} color={colors.mutedForeground} />
            }
          </TouchableOpacity>

          {/* Text input */}
          <TextInput
            ref={inputRef}
            style={[styles.textInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border, fontFamily: 'Inter_400Regular' }]}
            placeholder={waConnected ? `Message à ${relation?.participantOther ?? '…'}…` : 'Ajouter un message…'}
            placeholderTextColor={colors.mutedForeground}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            onFocus={() => setSuggestOpen(false)}
          />

          {/* AI Suggestions button */}
          <TouchableOpacity
            style={[styles.inputIconBtn, { backgroundColor: suggestOpen ? colors.accent + '20' : colors.muted }]}
            onPress={openSuggestions}
            activeOpacity={0.7}
          >
            <Feather name="zap" size={20} color={suggestOpen ? colors.accent : colors.mutedForeground} />
          </TouchableOpacity>

          {/* SOS button */}
          <TouchableOpacity
            style={[
              styles.inputIconBtn,
              sosActive
                ? { backgroundColor: '#ef4444', borderRadius: 20 }
                : { backgroundColor: colors.muted }
            ]}
            onPress={toggleSos}
            disabled={sosLoading}
            activeOpacity={0.7}
          >
            {sosLoading
              ? <ActivityIndicator size="small" color={sosActive ? '#fff' : colors.mutedForeground} />
              : <Feather name="shield" size={18} color={sosActive ? '#fff' : colors.mutedForeground} />
            }
          </TouchableOpacity>

          {/* Timer + Send buttons — visible when text present */}
          {inputText.trim().length > 0 && (
            <>
              {/* Timer de réponse */}
              <TouchableOpacity
                style={[styles.timerBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                onPress={() => { Keyboard.dismiss(); setTimerOpen(true); }}
                activeOpacity={0.7}
              >
                <Feather name="clock" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>

              {/* Send now */}
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: colors.primary }]}
                onPress={handleSendText}
                disabled={sendingText}
                activeOpacity={0.85}
              >
                {sendingText
                  ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                  : <Feather name={waConnected ? 'send' : 'plus'} size={18} color={colors.primaryForeground} />
                }
              </TouchableOpacity>
            </>
          )}

          {/* Ask ReLink button — shows when no text */}
          {inputText.trim().length === 0 && (
            <TouchableOpacity
              style={[styles.agentBtn, { backgroundColor: colors.primary }]}
              onPress={() => handleAgent()}
              activeOpacity={0.85}
            >
              <Feather name="message-square" size={16} color={colors.primaryForeground} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Timer de réponse Modal */}
      <Modal
        visible={timerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTimerOpen(false)}
      >
        <TouchableOpacity
          style={styles.timerOverlay}
          activeOpacity={1}
          onPress={() => setTimerOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.timerSheet, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
              <Text style={[styles.timerTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                ⏱ Timer de réponse
              </Text>
              <Text style={[styles.timerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Le message sera envoyé automatiquement
              </Text>

              {/* Immediate */}
              <TouchableOpacity
                style={[styles.timerImmediate, { backgroundColor: '#dcfce7', borderColor: '#86efac' }]}
                onPress={() => { setTimerOpen(false); setCustomTimerError(''); handleScheduleSend(inputText, 0); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.timerImmediateText, { color: '#15803d', fontFamily: 'Inter_600SemiBold' }]}>
                  ⚡ Envoyer maintenant
                </Text>
              </TouchableOpacity>

              {/* Presets grid */}
              <View style={styles.timerGrid}>
                {[
                  { label: '2 min', minutes: 2 },
                  { label: '5 min', minutes: 5 },
                  { label: '15 min', minutes: 15 },
                  { label: '30 min', minutes: 30 },
                  { label: '1h', minutes: 60 },
                  { label: '2h', minutes: 120 },
                  { label: '5h', minutes: 300 },
                  { label: '12h', minutes: 720 },
                  { label: '24h', minutes: 1440 },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.minutes}
                    style={[styles.timerPreset, { borderColor: colors.border, backgroundColor: colors.muted }]}
                    onPress={() => { setTimerOpen(false); setCustomTimerError(''); handleScheduleSend(inputText, opt.minutes); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.timerPresetText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Divider */}
              <View style={styles.timerDivider}>
                <View style={[styles.timerDividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.timerDividerText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  ou personnaliser
                </Text>
                <View style={[styles.timerDividerLine, { backgroundColor: colors.border }]} />
              </View>

              {/* Custom input */}
              <View style={styles.timerCustomRow}>
                <TextInput
                  style={[styles.timerCustomInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
                  keyboardType="numeric"
                  placeholder={customTimerUnit === 'min' ? 'Ex: 45' : 'Ex: 3'}
                  placeholderTextColor={colors.mutedForeground}
                  value={customTimerVal}
                  onChangeText={(t) => { setCustomTimerVal(t); setCustomTimerError(''); }}
                  maxLength={4}
                />
                {/* Unit toggle */}
                <View style={[styles.timerUnitToggle, { borderColor: colors.border }]}>
                  {(['min', 'h'] as const).map((u) => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.timerUnitBtn, customTimerUnit === u && { backgroundColor: colors.accent }]}
                      onPress={() => { setCustomTimerUnit(u); setCustomTimerVal(''); setCustomTimerError(''); }}
                    >
                      <Text style={[styles.timerUnitBtnText, { color: customTimerUnit === u ? colors.accentForeground : colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                        {u}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {customTimerError ? (
                <Text style={[styles.timerCustomError, { color: '#ef4444', fontFamily: 'Inter_400Regular' }]}>
                  {customTimerError}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.timerCustomConfirm, { backgroundColor: colors.accent, opacity: customTimerVal ? 1 : 0.4 }]}
                disabled={!customTimerVal}
                onPress={() => {
                  const n = parseInt(customTimerVal, 10);
                  const maxVal = customTimerUnit === 'min' ? 1440 : 24;
                  const minVal = customTimerUnit === 'min' ? 2 : 1;
                  if (isNaN(n) || n < minVal || n > maxVal) {
                    setCustomTimerError(`Entre ${minVal} et ${maxVal} ${customTimerUnit}`);
                    return;
                  }
                  const minutes = customTimerUnit === 'h' ? n * 60 : n;
                  setTimerOpen(false);
                  setCustomTimerVal('');
                  setCustomTimerError('');
                  handleScheduleSend(inputText, minutes);
                }}
                activeOpacity={0.8}
              >
                <Feather name="clock" size={16} color={colors.accentForeground} style={{ marginRight: 8 }} />
                <Text style={[styles.timerCustomConfirmText, { color: colors.accentForeground, fontFamily: 'Inter_600SemiBold' }]}>
                  Programmer
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.timerCancel, { borderTopColor: colors.border }]}
                onPress={() => setTimerOpen(false)}
              >
                <Text style={[{ color: colors.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 15 }]}>
                  Annuler
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Lightbox */}
      {lightboxUri && (
        <TouchableOpacity style={styles.lightbox} onPress={() => setLightboxUri(null)} activeOpacity={1}>
          <Image source={{ uri: lightboxUri }} style={styles.lightboxImage} contentFit="contain" />
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxUri(null)}>
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1, gap: 2 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  headerPhase: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  headerActions: { flexDirection: 'row', gap: 0 },
  iconBtn: { padding: 7 },
  iconBtnWrap: { position: 'relative' },
  statusDot: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#F7F4EE',
  },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 12, paddingTop: 12, gap: 2 },
  listContentEmpty: { flex: 1 },

  /* Day separators */
  dayRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12, gap: 8 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayLabelWrap: { flexDirection: 'row', alignItems: 'center' },
  dayLabel: {
    fontSize: 12, fontFamily: 'Inter_500Medium', paddingHorizontal: 8,
  },
  selectDayHint: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  /* Messages */
  msgRow: { marginVertical: 2, maxWidth: '82%', borderRadius: 4 },
  msgRowMe: { alignSelf: 'flex-end' },
  msgRowThem: { alignSelf: 'flex-start' },
  checkbox: { position: 'absolute', top: '50%', marginTop: -9, zIndex: 1 },
  checkboxLeft: { left: -26 },
  checkboxRight: { right: -26 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, gap: 4 },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleThem: { borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  senderName: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  mediaImage: { width: 200, height: 200, borderRadius: 10, marginBottom: 4 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  voiceLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', fontStyle: 'italic' },
  bubbleText: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  bubbleTime: { fontSize: 11, fontFamily: 'Inter_400Regular', alignSelf: 'flex-end' },

  /* Empty state */
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  emptyButton: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  emptyButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  /* Input bar */
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 10, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  inputIconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, maxHeight: 120, minHeight: 40,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  agentBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },

  /* Selection bar */
  selectionBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 12, gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectionCount: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1 },
  selectionActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  selActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
  },
  selActionText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  selCancelBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },

  /* Timer modal */
  timerBtn: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  timerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  timerSheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 24, paddingBottom: 44, paddingHorizontal: 20,
  },
  timerTitle: { fontSize: 18, marginBottom: 4 },
  timerSub: { fontSize: 13, marginBottom: 16 },
  timerImmediate: {
    borderWidth: 1, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', marginBottom: 12,
  },
  timerImmediateText: { fontSize: 15 },
  timerGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  timerPreset: {
    borderWidth: 1, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    alignItems: 'center',
  },
  timerPresetText: { fontSize: 14 },
  timerDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14,
  },
  timerDividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  timerDividerText: { fontSize: 12 },
  timerCustomRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8,
  },
  timerCustomInput: {
    flex: 1, height: 44, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, fontSize: 15,
  },
  timerUnitToggle: {
    flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden',
  },
  timerUnitBtn: {
    paddingVertical: 10, paddingHorizontal: 14,
  },
  timerUnitBtnText: { fontSize: 14 },
  timerCustomConfirm: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 44, borderRadius: 10, marginBottom: 8,
  },
  timerCustomConfirmText: { fontSize: 15 },
  timerCustomError: { fontSize: 12, marginBottom: 6 },
  timerCancel: {
    marginTop: 4, paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },

  /* Lightbox */
  lightbox: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  lightboxImage: { width: '100%', height: '80%' },
  lightboxClose: {
    position: 'absolute', top: 50, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
});
