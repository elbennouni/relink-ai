import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetRelation, useGetMemory, useGetRelationPhases } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { fetch } from 'expo/fetch';

function parseSSE(chunk: string): { type?: string; progress?: number; message?: string; done?: boolean } {
  for (const line of chunk.split('\n')) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.slice(6)); } catch { }
    }
  }
  return {};
}

function Chip({ label, colors }: { label: string; colors: any }) {
  return (
    <View style={[styles.chip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      <Text style={[styles.chipText, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

function Section({ title, children, colors }: { title: string; children: React.ReactNode; colors: any }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {children}
    </View>
  );
}

export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationId = Number(id);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildStatus, setBuildStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: memory, isLoading, refetch } = useGetMemory(
    relationId,
    { query: { enabled: !!relationId } }
  );
  const { data: phases } = useGetRelationPhases(
    relationId,
    { query: { enabled: !!relationId } }
  );

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleBuildMemory = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBuilding(true);
    setBuildProgress(0);
    setBuildStatus('Analyse des messages…');

    try {
      const response = await fetch(
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/relations/${relationId}/memory/build`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const parsed = parseSSE(event);
          if (parsed.progress !== undefined) setBuildProgress(parsed.progress);
          if (parsed.message) setBuildStatus(parsed.message);
          if (parsed.done) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await refetch();
          }
        }
      }
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', 'La construction de la mémoire a échoué.');
    } finally {
      setBuilding(false);
      setBuildProgress(0);
      setBuildStatus('');
    }
  }, [relationId, refetch]);

  const recurringTopics: string[] = (() => {
    if (!memory?.recurringTopics) return [];
    if (Array.isArray(memory.recurringTopics)) return memory.recurringTopics as string[];
    try { return JSON.parse(memory.recurringTopics as string); } catch { return []; }
  })();

  const expressedLimits: string[] = (() => {
    if (!memory?.expressedLimits) return [];
    if (Array.isArray(memory.expressedLimits)) return memory.expressedLimits as string[];
    try { return JSON.parse(memory.expressedLimits as string); } catch { return []; }
  })();

  const openQuestions: string[] = (() => {
    if (!memory?.openQuestions) return [];
    if (Array.isArray(memory.openQuestions)) return memory.openQuestions as string[];
    try { return JSON.parse(memory.openQuestions as string); } catch { return []; }
  })();

  const importantEvents: string[] = (() => {
    if (!memory?.importantEvents) return [];
    if (Array.isArray(memory.importantEvents)) return memory.importantEvents as string[];
    try { return JSON.parse(memory.importantEvents as string); } catch { return []; }
  })();

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const hasMemory = !!memory?.globalSummary && !memory.isBuilding;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Build / Rebuild button */}
        <TouchableOpacity
          style={[
            styles.buildButton,
            {
              backgroundColor: building ? colors.muted : colors.primary,
              borderColor: colors.border,
            },
          ]}
          onPress={handleBuildMemory}
          disabled={building}
          activeOpacity={0.85}
        >
          {building ? (
            <View style={styles.buildProgress}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.buildStatusText, { color: colors.foreground }]}>
                  {buildStatus}
                </Text>
                <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      { backgroundColor: colors.accent, width: `${buildProgress}%` as any },
                    ]}
                  />
                </View>
              </View>
            </View>
          ) : (
            <>
              <Feather name="cpu" size={18} color={hasMemory ? colors.primaryForeground : colors.primaryForeground} />
              <Text style={[styles.buildButtonText, { color: colors.primaryForeground }]}>
                {hasMemory ? 'Reconstruire la mémoire' : 'Construire la mémoire'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {!hasMemory && !building && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="info" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Aucune mémoire construite. Importez des messages puis lancez la construction.
            </Text>
          </View>
        )}

        {hasMemory && (
          <>
            {/* Global summary */}
            <Section title="RÉSUMÉ GLOBAL" colors={colors}>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.summaryText, { color: colors.foreground }]}>
                  {memory.globalSummary}
                </Text>
              </View>
            </Section>

            {/* Current phase */}
            {memory.currentPhase && (
              <Section title="PHASE ACTUELLE" colors={colors}>
                <View style={[styles.phaseCard, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}>
                  <View style={[styles.phaseDot, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.phaseText, { color: colors.accent }]}>
                    {memory.currentPhase}
                  </Text>
                </View>
              </Section>
            )}

            {/* Phases timeline */}
            {phases && phases.length > 0 && (
              <Section title="CHRONOLOGIE" colors={colors}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {phases.map((phase, idx) => (
                    <View key={phase.id} style={[styles.timelineRow, idx < phases.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                      <View style={[styles.timelineDot, { backgroundColor: phase.isCurrentPhase ? colors.accent : colors.muted }]} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.timelineLabel, { color: phase.isCurrentPhase ? colors.accent : colors.foreground }]}>
                          {phase.label}
                        </Text>
                        {phase.description && (
                          <Text style={[styles.timelineDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                            {phase.description}
                          </Text>
                        )}
                        {phase.startDate && (
                          <Text style={[styles.timelineDate, { color: colors.mutedForeground }]}>
                            {new Date(phase.startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {phase.endDate ? ` → ${new Date(phase.endDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : ''}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              </Section>
            )}

            {/* Recurring topics */}
            {recurringTopics.length > 0 && (
              <Section title="SUJETS RÉCURRENTS" colors={colors}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                  {recurringTopics.map((topic, i) => (
                    <Chip key={i} label={topic} colors={colors} />
                  ))}
                </ScrollView>
              </Section>
            )}

            {/* Expressed limits */}
            {expressedLimits.length > 0 && (
              <Section title="LIMITES EXPRIMÉES" colors={colors}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {expressedLimits.map((limit, i) => (
                    <View key={i} style={[styles.listRow, i < expressedLimits.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                      <View style={[styles.bullet, { backgroundColor: colors.accent }]} />
                      <Text style={[styles.listText, { color: colors.foreground }]}>{limit}</Text>
                    </View>
                  ))}
                </View>
              </Section>
            )}

            {/* Open questions */}
            {openQuestions.length > 0 && (
              <Section title="QUESTIONS OUVERTES" colors={colors}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {openQuestions.map((q, i) => (
                    <View key={i} style={[styles.listRow, i < openQuestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                      <Feather name="help-circle" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
                      <Text style={[styles.listText, { color: colors.foreground }]}>{q}</Text>
                    </View>
                  ))}
                </View>
              </Section>
            )}

            {/* Important events */}
            {importantEvents.length > 0 && (
              <Section title="ÉVÉNEMENTS IMPORTANTS" colors={colors}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {importantEvents.map((ev, i) => (
                    <View key={i} style={[styles.listRow, i < importantEvents.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                      <Feather name="calendar" size={14} color={colors.accent} style={{ marginTop: 2 }} />
                      <Text style={[styles.listText, { color: colors.foreground }]}>{ev}</Text>
                    </View>
                  ))}
                </View>
              </Section>
            )}

            {memory.builtAt && (
              <Text style={[styles.builtAt, { color: colors.mutedForeground }]}>
                Mémoire construite le{' '}
                {new Date(memory.builtAt).toLocaleDateString('fr-FR', {
                  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 20 },
  buildButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buildButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  buildProgress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
  },
  buildStatusText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
    paddingLeft: 2,
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  summaryText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 24,
    padding: 16,
  },
  phaseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  phaseText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    flexShrink: 0,
  },
  timelineLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  timelineDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  timelineDate: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  chipsRow: {
    gap: 8,
    paddingLeft: 2,
    paddingRight: 16,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    flexShrink: 0,
  },
  listText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  builtAt: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingVertical: 8,
  },
});
