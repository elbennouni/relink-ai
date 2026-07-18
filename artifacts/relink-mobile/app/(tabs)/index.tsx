import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useListRelations } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Bonne nuit.';
  if (h < 12) return 'Bonjour.';
  if (h < 18) return 'Bon après-midi.';
  return 'Bonsoir.';
}

function formatRelativeDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: relations, isLoading, refetch, isRefetching } = useListRelations();

  const handleNewRelation = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/relations/new');
  }, [router]);

  const handleOpenRelation = useCallback((id: number) => {
    Haptics.selectionAsync();
    router.push(`/relations/${id}`);
  }, [router]);

  const styles = makeStyles(colors, insets);

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Feather name="inbox" size={28} color={colors.mutedForeground} />
      </View>
      <Text style={styles.emptyTitle}>Aucune relation</Text>
      <Text style={styles.emptySubtitle}>
        Commencez par créer une relation pour analyser vos conversations.
      </Text>
      <TouchableOpacity style={styles.emptyButton} onPress={handleNewRelation} activeOpacity={0.8}>
        <Text style={styles.emptyButtonText}>Créer une relation</Text>
      </TouchableOpacity>
    </View>
  );

  type Relation = NonNullable<typeof relations>[number];
  const renderRelation = ({ item }: { item: Relation }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => handleOpenRelation(item.id)}
      activeOpacity={0.75}
    >
      <View style={styles.cardLeft}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.participantOther?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.cardDate}>{formatRelativeDate(item.lastMessageAt)}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardParticipants} numberOfLines={1}>
            {item.participantMe} · {item.participantOther}
          </Text>
          <View style={styles.cardMeta}>
            {item.memoryBuiltAt && (
              <View style={[styles.memoryDot, { backgroundColor: colors.accent }]} />
            )}
            <Text style={styles.cardCount}>{item.messageCount ?? 0} msg</Text>
          </View>
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: colors.foreground }]}>{greeting()}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Cet espace est le vôtre.
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={handleNewRelation}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={relations ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderRelation}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            styles.listContent,
            !(relations?.length) && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!relations?.length}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
          )}
        />
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) {
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: topPad + 20,
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    greeting: {
      fontSize: 28,
      fontFamily: 'Inter_700Bold',
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      marginTop: 2,
    },
    addButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: bottomPad + 16,
    },
    listContentEmpty: {
      flex: 1,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 68,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      gap: 12,
    },
    cardLeft: { alignItems: 'center' },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 18,
      fontFamily: 'Inter_600SemiBold',
      color: colors.mutedForeground,
    },
    cardBody: { flex: 1, gap: 3 },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cardName: {
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
      color: colors.foreground,
      flex: 1,
    },
    cardDate: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      marginLeft: 8,
    },
    cardParticipants: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      flex: 1,
    },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    memoryDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    cardCount: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 40,
      gap: 12,
    },
    emptyIcon: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    emptyTitle: {
      fontSize: 18,
      fontFamily: 'Inter_600SemiBold',
      color: colors.foreground,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 20,
    },
    emptyButton: {
      marginTop: 8,
      paddingHorizontal: 24,
      paddingVertical: 12,
      backgroundColor: colors.primary,
      borderRadius: 24,
    },
    emptyButtonText: {
      fontSize: 15,
      fontFamily: 'Inter_600SemiBold',
      color: colors.primaryForeground,
    },
  });
}
