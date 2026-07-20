import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetRelation, useListMessages } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { SuggestRepliesSheet } from '@/app/components/SuggestRepliesSheet';

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
  type?: 'separator';
  dateLabel?: string;
};

function groupWithSeparators(messages: Msg[]): (Msg | { type: 'separator'; dateLabel: string; id: string })[] {
  const result: any[] = [];
  let lastDay = '';
  for (const msg of messages) {
    const day = new Date(msg.sentAt).toDateString();
    if (day !== lastDay) {
      result.push({ type: 'separator', dateLabel: formatDay(msg.sentAt), id: `sep-${day}` });
      lastDay = day;
    }
    result.push(msg);
  }
  return result;
}

export default function WorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationId = Number(id);
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const {
    data: messageData,
    isLoading,
    refetch,
    isRefetching,
  } = useListMessages(relationId, { query: { enabled: !!relationId } });

  const [waConnected, setWaConnected] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  // Check WhatsApp status on mount
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`https://${domain}/api/relations/${relationId}/whatsapp/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        setWaConnected(data.status === 'connected');
      } catch {}
    })();
  }, [relationId]);

  const messages = (messageData?.messages ?? []) as Msg[];
  const grouped = groupWithSeparators(messages);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleAgent = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/relations/${relationId}/agent`);
  }, [relationId, router]);

  const handleImport = useCallback(() => {
    router.push(`/relations/${relationId}/import`);
  }, [relationId, router]);

  const handleMemory = useCallback(() => {
    router.push(`/relations/${relationId}/memory`);
  }, [relationId, router]);

  const handleWhatsApp = useCallback(() => {
    router.push(`/relations/${relationId}/whatsapp`);
  }, [relationId, router]);

  const handleNoContact = useCallback(() => {
    router.push(`/relations/${relationId}/no-contact`);
  }, [relationId, router]);

  const renderItem = ({ item }: { item: any }) => {
    if (item.type === 'separator') {
      return (
        <View style={styles.dayRow}>
          <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dayLabel, { color: colors.mutedForeground, backgroundColor: colors.background }]}>
            {item.dateLabel}
          </Text>
          <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
        </View>
      );
    }

    const msg = item as Msg;
    const isImage = !!msg.mediaData && msg.mediaData.startsWith('data:image');
    const isAudio = !!msg.mediaData && msg.mediaData.startsWith('data:audio');
    const isVoiceText = msg.content.startsWith('[Vocal]');

    return (
      <View style={[styles.msgRow, msg.isMe ? styles.msgRowMe : styles.msgRowThem]}>
        <View
          style={[
            styles.bubble,
            msg.isMe
              ? [styles.bubbleMe, { backgroundColor: colors.bubbleMe }]
              : [styles.bubbleThem, { backgroundColor: colors.bubbleThem, borderColor: colors.border }],
          ]}
        >
          {!msg.isMe && (
            <Text style={[styles.senderName, { color: colors.accent }]}>{msg.sender}</Text>
          )}

          {/* Image media */}
          {isImage && (
            <TouchableOpacity onPress={() => setLightboxUri(msg.mediaData!)} activeOpacity={0.9}>
              <Image
                source={{ uri: msg.mediaData! }}
                style={styles.mediaImage}
                contentFit="cover"
              />
            </TouchableOpacity>
          )}

          {/* Audio / vocal */}
          {(isAudio || isVoiceText) && (
            <View style={[styles.voiceRow, { backgroundColor: msg.isMe ? 'rgba(255,255,255,0.15)' : colors.muted, borderRadius: 10, padding: 8 }]}>
              <Feather name="mic" size={14} color={msg.isMe ? colors.bubbleMeText : colors.accent} />
              <Text style={[styles.voiceLabel, { color: msg.isMe ? colors.bubbleMeText : colors.mutedForeground }]}>
                Vocal
              </Text>
            </View>
          )}

          {/* Text content */}
          {!!msg.content && !isImage && (
            <Text style={[
              styles.bubbleText,
              { color: msg.isMe ? colors.bubbleMeText : colors.bubbleThemText },
            ]}>
              {isVoiceText
                ? msg.content.replace('[Vocal] ', '')
                : msg.content}
            </Text>
          )}

          <Text style={[
            styles.bubbleTime,
            { color: msg.isMe ? colors.bubbleMeText + 'AA' : colors.mutedForeground },
          ]}>
            {formatTime(msg.sentAt)}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Feather name="message-circle" size={36} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        Aucun message importé
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
        Importez une conversation WhatsApp ou ajoutez des messages manuellement.
      </Text>
      <TouchableOpacity
        style={[styles.emptyButton, { backgroundColor: colors.primary }]}
        onPress={handleImport}
        activeOpacity={0.85}
      >
        <Text style={[styles.emptyButtonText, { color: colors.primaryForeground }]}>
          Importer des messages
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Custom header */}
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
          {/* WhatsApp with live dot */}
          <TouchableOpacity onPress={handleWhatsApp} style={styles.iconBtn} activeOpacity={0.7}>
            <View style={styles.iconBtnWrap}>
              <Feather name="smartphone" size={20} color={colors.foreground} />
              <View style={[styles.statusDot, { backgroundColor: waConnected ? '#10B981' : '#9CA3AF' }]} />
            </View>
          </TouchableOpacity>

          {/* No Contact */}
          <TouchableOpacity onPress={handleNoContact} style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="shield-off" size={20} color={colors.foreground} />
          </TouchableOpacity>

          {/* Memory */}
          <TouchableOpacity onPress={handleMemory} style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="cpu" size={20} color={colors.foreground} />
          </TouchableOpacity>

          {/* Import */}
          <TouchableOpacity onPress={handleImport} style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="upload" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

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
            { paddingBottom: bottomPad + 100 },
            !messages.length && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!messages.length}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
        />
      )}

      {/* FABs */}
      <View style={[styles.fabContainer, { bottom: bottomPad + 16 }]}>
        {/* Suggestions IA */}
        {messages.length > 0 && (
          <TouchableOpacity
            style={[styles.fabSecondary, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setSuggestOpen(true)}
            activeOpacity={0.85}
          >
            <Feather name="zap" size={16} color={colors.accent} />
            <Text style={[styles.fabSecondaryText, { color: colors.foreground }]}>
              Suggestions IA
            </Text>
          </TouchableOpacity>
        )}

        {/* Ask ReLink */}
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={handleAgent}
          activeOpacity={0.85}
        >
          <Feather name="message-square" size={18} color={colors.primaryForeground} />
          <Text style={[styles.fabText, { color: colors.primaryForeground }]}>
            Demander à ReLink
          </Text>
        </TouchableOpacity>
      </View>

      {/* Lightbox for images */}
      {lightboxUri && (
        <TouchableOpacity
          style={styles.lightbox}
          onPress={() => setLightboxUri(null)}
          activeOpacity={1}
        >
          <Image
            source={{ uri: lightboxUri }}
            style={styles.lightboxImage}
            contentFit="contain"
          />
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxUri(null)}>
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* Suggest Replies Sheet */}
      <SuggestRepliesSheet
        visible={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        relationId={relationId}
        contactName={relation?.participantOther ?? '…'}
        waConnected={waConnected}
        onPasteToAgent={(text) => {
          setSuggestOpen(false);
          router.push({ pathname: `/relations/${relationId}/agent`, params: { prefill: text } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1, gap: 2 },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
  },
  headerPhase: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 0,
  },
  iconBtn: { padding: 7 },
  iconBtnWrap: { position: 'relative' },
  statusDot: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#F7F4EE',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 2,
  },
  listContentEmpty: { flex: 1 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 8,
  },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    paddingHorizontal: 8,
  },
  msgRow: {
    marginVertical: 2,
    maxWidth: '80%',
  },
  msgRowMe: { alignSelf: 'flex-end' },
  msgRowThem: { alignSelf: 'flex-start' },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 4,
  },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleThem: {
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  senderName: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  mediaImage: {
    width: 200,
    height: 200,
    borderRadius: 10,
    marginBottom: 4,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  voiceLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    fontStyle: 'italic',
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  bubbleTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    alignSelf: 'flex-end',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  fabContainer: {
    position: 'absolute',
    right: 16,
    gap: 10,
    alignItems: 'flex-end',
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  fabSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  fabSecondaryText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  lightbox: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  lightboxImage: {
    width: '100%',
    height: '80%',
  },
  lightboxClose: {
    position: 'absolute',
    top: 50, right: 20,
    width: 40, height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
