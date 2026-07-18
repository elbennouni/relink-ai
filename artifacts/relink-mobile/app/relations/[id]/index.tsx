import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, RefreshControl, Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetRelation, useListMessages } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

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

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const {
    data: messageData,
    isLoading,
    refetch,
    isRefetching,
  } = useListMessages(relationId, { query: { enabled: !!relationId } });

  const messages = messageData?.messages ?? [];
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
          <Text style={[
            styles.bubbleText,
            { color: msg.isMe ? colors.bubbleMeText : colors.bubbleThemText },
          ]}>
            {msg.content}
          </Text>
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
          <TouchableOpacity onPress={handleMemory} style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="cpu" size={20} color={colors.foreground} />
          </TouchableOpacity>
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
            { paddingBottom: bottomPad + 80 },
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

      {/* FAB - Ask ReLink */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary, bottom: bottomPad + 16 }]}
        onPress={handleAgent}
        activeOpacity={0.85}
      >
        <Feather name="zap" size={18} color={colors.primaryForeground} />
        <Text style={[styles.fabText, { color: colors.primaryForeground }]}>
          Demander à ReLink
        </Text>
      </TouchableOpacity>
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
    gap: 4,
  },
  iconBtn: {
    padding: 8,
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
  bubbleMe: {
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  senderName: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
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
  fab: {
    position: 'absolute',
    right: 16,
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
});
