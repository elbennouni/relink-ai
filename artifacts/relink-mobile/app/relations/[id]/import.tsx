import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useImportPaste, useImportManual, useGetRelation } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

type Tab = 'paste' | 'manual';

type ImportResult = {
  imported: number;
  duplicates: number;
  totalMessages: number;
  dateRange: { from: string | null; to: string | null };
};

export default function ImportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationId = Number(id);
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('paste');
  const [pasteText, setPasteText] = useState('');
  const [manualSender, setManualSender] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [manualIsMe, setManualIsMe] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const importPaste = useImportPaste();
  const importManual = useImportManual();

  const isLoading = importPaste.isPending || importManual.isPending;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handlePasteImport = async () => {
    if (!pasteText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await importPaste.mutateAsync({
        relationId,
        data: {
          text: pasteText.trim(),
          participantMe: relation?.participantMe ?? 'Moi',
          participantOther: relation?.participantOther ?? 'Eux',
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(res);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', "L'importation a échoué. Vérifiez le format du texte.");
    }
  };

  const handleManualImport = async () => {
    if (!manualSender.trim() || !manualContent.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await importManual.mutateAsync({
        relationId,
        data: {
          sender: manualSender.trim(),
          content: manualContent.trim(),
          isMe: manualIsMe,
          sentAt: new Date().toISOString(),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({ imported: 1, duplicates: 0, totalMessages: 1, dateRange: { from: null, to: null } });
      setManualContent('');
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', 'Impossible d\'ajouter le message.');
    }
  };

  // Success screen
  if (result) {
    return (
      <View style={[styles.successContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.accent + '20' }]}>
          <Feather name="check-circle" size={40} color={colors.accent} />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>
          {result.imported} message{result.imported > 1 ? 's' : ''} importé{result.imported > 1 ? 's' : ''}
        </Text>
        {result.duplicates > 0 && (
          <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
            {result.duplicates} doublon{result.duplicates > 1 ? 's' : ''} ignoré{result.duplicates > 1 ? 's' : ''}
          </Text>
        )}
        <Text style={[styles.successTotal, { color: colors.mutedForeground }]}>
          Total : {result.totalMessages} messages
        </Text>

        <View style={styles.successActions}>
          <TouchableOpacity
            style={[styles.successBtn, { backgroundColor: colors.primary }]}
            onPress={() => { setResult(null); setPasteText(''); }}
            activeOpacity={0.85}
          >
            <Text style={[styles.successBtnText, { color: colors.primaryForeground }]}>
              Importer davantage
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.successBtn, { backgroundColor: colors.muted }]}
            onPress={() => router.push(`/relations/${relationId}/memory`)}
            activeOpacity={0.85}
          >
            <Text style={[styles.successBtnText, { color: colors.foreground }]}>
              Construire la mémoire
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.successBtnOutline, { borderColor: colors.border }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={[styles.successBtnText, { color: colors.mutedForeground }]}>
              Retour à la conversation
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {(['paste', 'manual'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
            onPress={() => setTab(t)}
            activeOpacity={0.75}
          >
            <Text style={[
              styles.tabText,
              { color: tab === t ? colors.accent : colors.mutedForeground, fontFamily: tab === t ? 'Inter_600SemiBold' : 'Inter_400Regular' },
            ]}>
              {t === 'paste' ? 'Coller le texte' : 'Manuel'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {tab === 'paste' && (
          <View style={styles.section}>
            <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
              Ouvrez WhatsApp → conversation → trois points → Exporter la discussion → collez le texte ici.
            </Text>
            <TextInput
              style={[styles.textarea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              multiline
              numberOfLines={10}
              placeholder="Collez votre export WhatsApp ici..."
              placeholderTextColor={colors.mutedForeground}
              value={pasteText}
              onChangeText={setPasteText}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.button, { backgroundColor: pasteText.trim() ? colors.primary : colors.muted }]}
              onPress={handlePasteImport}
              disabled={!pasteText.trim() || isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={[styles.buttonText, { color: pasteText.trim() ? colors.primaryForeground : colors.mutedForeground }]}>
                  Importer
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {tab === 'manual' && (
          <View style={styles.section}>
            <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
              Ajoutez un message que vous avez reçu ou envoyé.
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Expéditeur</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                placeholder={relation?.participantOther ?? 'Prénom'}
                placeholderTextColor={colors.mutedForeground}
                value={manualSender}
                onChangeText={setManualSender}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Message</Text>
              <TextInput
                style={[styles.textarea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular', minHeight: 100 }]}
                multiline
                placeholder="Contenu du message..."
                placeholderTextColor={colors.mutedForeground}
                value={manualContent}
                onChangeText={setManualContent}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Envoyé par moi</Text>
              <TouchableOpacity
                style={[styles.toggle, { backgroundColor: manualIsMe ? colors.accent : colors.muted }]}
                onPress={() => setManualIsMe((v) => !v)}
                activeOpacity={0.8}
              >
                <View style={[styles.toggleThumb, { transform: [{ translateX: manualIsMe ? 20 : 2 }] }]} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: (manualSender.trim() && manualContent.trim()) ? colors.primary : colors.muted }]}
              onPress={handleManualImport}
              disabled={!manualSender.trim() || !manualContent.trim() || isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={[styles.buttonText, { color: (manualSender.trim() && manualContent.trim()) ? colors.primaryForeground : colors.mutedForeground }]}>
                  Ajouter le message
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
  },
  content: { padding: 20, gap: 16 },
  section: { gap: 16 },
  helpText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  fieldGroup: { gap: 6 },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 160,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  button: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  // Success
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  successSub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  successTotal: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 8,
  },
  successActions: {
    width: '100%',
    gap: 10,
    marginTop: 8,
  },
  successBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  successBtnOutline: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  successBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
