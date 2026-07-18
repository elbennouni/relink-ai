import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';

function SettingRow({
  icon,
  label,
  value,
  onPress,
  colors,
  destructive = false,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  colors: any;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      disabled={!onPress}
    >
      <View style={[styles.rowIcon, { backgroundColor: destructive ? colors.destructive + '18' : colors.muted }]}>
        <Feather
          name={icon as any}
          size={16}
          color={destructive ? colors.destructive : colors.mutedForeground}
        />
      </View>
      <Text style={[styles.rowLabel, { color: destructive ? colors.destructive : colors.foreground }]}>
        {label}
      </Text>
      {value ? (
        <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{value}</Text>
      ) : onPress ? (
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      ) : null}
    </TouchableOpacity>
  );
}

function Section({ title, children, colors }: { title: string; children: React.ReactNode; colors: any }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleClearCache = () => {
    Alert.alert(
      'Vider le cache',
      'Cela effacera toutes les données en cache. Vos relations resteront intactes.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Vider',
          style: 'destructive',
          onPress: () => queryClient.clear(),
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 20 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Paramètres</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Section title="CONFIDENTIALITÉ" colors={colors}>
          <SettingRow
            icon="shield"
            label="Données chiffrées"
            value="Activé"
            colors={colors}
          />
          <SettingRow
            icon="server"
            label="Stockage local"
            value="Sur vos serveurs"
            colors={colors}
          />
        </Section>

        <Section title="DONNÉES" colors={colors}>
          <SettingRow
            icon="refresh-cw"
            label="Vider le cache"
            onPress={handleClearCache}
            colors={colors}
          />
        </Section>

        <Section title="À PROPOS" colors={colors}>
          <SettingRow icon="info" label="Version" value="1.0.0" colors={colors} />
          <SettingRow
            icon="heart"
            label="Conçu avec soin"
            value="ReLink AI"
            colors={colors}
          />
        </Section>

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          ReLink AI vous aide à analyser vos conversations avec lucidité.{'\n'}
          Vos données ne quittent jamais votre espace.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  content: {
    paddingHorizontal: 16,
    gap: 24,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
    paddingLeft: 4,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  rowValue: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  footer: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
});
