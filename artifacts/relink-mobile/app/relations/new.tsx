import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useCreateRelation } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

export default function NewRelationScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [participantMe, setParticipantMe] = useState('');
  const [participantOther, setParticipantOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const meRef = useRef<TextInput>(null);
  const otherRef = useRef<TextInput>(null);

  const createMutation = useCreateRelation();

  const canSubmit = name.trim() && participantMe.trim() && participantOther.trim();

  const handleSubmit = async () => {
    if (!canSubmit || createMutation.isPending) return;
    setError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await createMutation.mutateAsync({
        data: {
          name: name.trim(),
          participantMe: participantMe.trim(),
          participantOther: participantOther.trim(),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/relations/${result.id}`);
    } catch {
      setError('Une erreur est survenue. Réessayez.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.content, { paddingBottom: bottomPad + 24 }]}>
        <Text style={[styles.lead, { color: colors.mutedForeground }]}>
          Donnez un nom à cette relation pour commencer votre analyse.
        </Text>

        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Nom de la relation</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                fontFamily: 'Inter_400Regular',
              }]}
              placeholder="ex. Tom & Alex"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
              onSubmitEditing={() => meRef.current?.focus()}
              autoFocus
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Moi</Text>
              <TextInput
                ref={meRef}
                style={[styles.input, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: 'Inter_400Regular',
                }]}
                placeholder="Votre prénom"
                placeholderTextColor={colors.mutedForeground}
                value={participantMe}
                onChangeText={setParticipantMe}
                returnKeyType="next"
                onSubmitEditing={() => otherRef.current?.focus()}
              />
            </View>

            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>L'autre</Text>
              <TextInput
                ref={otherRef}
                style={[styles.input, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: 'Inter_400Regular',
                }]}
                placeholder="Son prénom"
                placeholderTextColor={colors.mutedForeground}
                value={participantOther}
                onChangeText={setParticipantOther}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>
          </View>

          {error && (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: canSubmit ? colors.primary : colors.muted },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || createMutation.isPending}
          activeOpacity={0.85}
        >
          {createMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <Text style={[styles.buttonText, { color: canSubmit ? colors.primaryForeground : colors.mutedForeground }]}>
              Créer la relation
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 32,
  },
  lead: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  fields: { gap: 16 },
  fieldGroup: { gap: 6 },
  row: { flexDirection: 'row', gap: 12 },
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
  error: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: -8,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
