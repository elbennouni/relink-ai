import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetRelation } from '@workspace/api-client-react';
import { useAuth } from '@clerk/expo';
import { fetch } from 'expo/fetch';

const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

type Status = 'none' | 'connecting' | 'qr' | 'connected' | 'disconnected';
type HistoryPeriod = '0' | '7' | '60' | '180' | '3650';

const HISTORY_OPTIONS: { value: HistoryPeriod; label: string; sub: string }[] = [
  { value: '0',    label: 'Aucun',    sub: 'Temps réel' },
  { value: '7',    label: '1 sem.',   sub: '7 jours' },
  { value: '60',   label: '2 mois',   sub: '60 jours' },
  { value: '180',  label: '6 mois',   sub: '180 jours' },
  { value: '3650', label: 'Tout',     sub: 'Complet' },
];

export default function WhatsAppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationId = Number(id);
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const contactName = relation?.participantOther ?? '…';

  const [status, setStatus] = useState<Status>('none');
  const [qrData, setQrData] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('60');
  const [historyImporting, setHistoryImporting] = useState<{ total: number } | null>(null);
  const [historyDone, setHistoryDone] = useState<{ imported: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Check initial status
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`https://${domain}/api/relations/${relationId}/whatsapp/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        setStatus(data.status ?? 'none');
      } catch {}
    })();
    return () => { abortRef.current?.abort(); };
  }, []);

  const startSSE = useCallback(async (contactPhone?: string, historyDays?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('connecting');
    setQrData(null);
    setHistoryImporting(null);
    setHistoryDone(null);

    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (contactPhone) params.set('contactPhone', contactPhone);
      if (historyDays !== undefined) params.set('historyDays', historyDays);
      const qs = params.toString();
      const res = await fetch(
        `https://${domain}/api/relations/${relationId}/whatsapp/qr${qs ? `?${qs}` : ''}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        } as any
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'qr') {
                setStatus('qr');
                setQrData(data.data);
              } else if (data.type === 'connected') {
                setStatus('connected');
                setQrData(null);
              } else if (data.type === 'history-importing') {
                setHistoryImporting({ total: data.total });
              } else if (data.type === 'history-done') {
                setHistoryImporting(null);
                setHistoryDone({ imported: data.imported });
                reader.cancel();
                return;
              } else if (data.type === 'disconnected') {
                setStatus(data.loggedOut ? 'none' : 'disconnected');
                setQrData(null);
                reader.cancel();
                return;
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setStatus('disconnected');
    }
  }, [relationId, getToken]);

  const handleConnect = () => {
    const cleaned = phone.replace(/\D/g, '');
    startSSE(cleaned || undefined, historyPeriod);
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Déconnecter WhatsApp',
      'La session sera supprimée. Continuer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Déconnecter', style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            abortRef.current?.abort();
            try {
              const token = await getToken();
              await fetch(`https://${domain}/api/relations/${relationId}/whatsapp/disconnect-qr`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              setStatus('none');
              setQrData(null);
              setHistoryDone(null);
            } catch {}
            finally { setDisconnecting(false); }
          },
        },
      ]
    );
  };

  const topPad = insets.top + 8;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>WhatsApp</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{contactName}</Text>
        </View>
        {/* Status badge */}
        <View style={[
          styles.badge,
          { backgroundColor: status === 'connected' ? '#D1FAE5' : colors.muted },
        ]}>
          <View style={[
            styles.dot,
            { backgroundColor: status === 'connected' ? '#10B981' : status === 'qr' || status === 'connecting' ? '#F59E0B' : '#9CA3AF' },
          ]} />
          <Text style={[styles.badgeText, { color: status === 'connected' ? '#065F46' : colors.mutedForeground }]}>
            {status === 'connected' ? 'Connecté' : status === 'connecting' ? 'Connexion…' : status === 'qr' ? 'En attente' : 'Déconnecté'}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        {/* Instructions */}
        <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>
            <Feather name="info" size={13} /> Comment ça marche
          </Text>
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            1. Saisis le numéro de {contactName} (optionnel){'\n'}
            2. Choisis l'historique à importer{'\n'}
            3. Génère le QR code{'\n'}
            4. WhatsApp → Appareils connectés → Connecter → Scanne !
          </Text>
        </View>

        {/* Main card */}
        {(status === 'none' || status === 'disconnected') && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {status === 'disconnected' && (
              <View style={[styles.warnRow, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
                <Feather name="wifi-off" size={14} color="#92400E" />
                <Text style={[styles.warnText, { color: '#92400E' }]}>Connexion perdue. Reconnecte-toi.</Text>
              </View>
            )}
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Numéro de {contactName}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              placeholder="+33 6 12 34 56 78 (optionnel)"
              placeholderTextColor={colors.mutedForeground}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Laisse vide pour capturer tous les contacts
            </Text>

            {/* History period */}
            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 4 }]}>
              Historique à importer
            </Text>
            <View style={styles.historyRow}>
              {HISTORY_OPTIONS.map((opt) => {
                const selected = historyPeriod === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.historyChip,
                      {
                        backgroundColor: selected ? colors.primary : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                        flex: 1,
                      },
                    ]}
                    onPress={() => setHistoryPeriod(opt.value)}
                    activeOpacity={0.75}
                  >
                    <Text style={[
                      styles.historyChipLabel,
                      { color: selected ? colors.primaryForeground : colors.foreground },
                    ]}>{opt.label}</Text>
                    <Text style={[
                      styles.historyChipSub,
                      { color: selected ? colors.primaryForeground : colors.mutedForeground, opacity: selected ? 0.85 : 0.65 },
                    ]}>{opt.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={handleConnect}
              activeOpacity={0.85}
            >
              <Feather name="maximize" size={16} color={colors.primaryForeground} />
              <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Générer le QR code</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'connecting' && (
          <View style={[styles.card, styles.cardCenter, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Connexion en cours…</Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Génération du QR code</Text>
          </View>
        )}

        {status === 'qr' && (
          <View style={[styles.card, styles.cardCenter, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Scanne avec ton téléphone</Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
              WhatsApp → Appareils connectés → Connecter
            </Text>
            {qrData ? (
              <Image
                source={{ uri: qrData }}
                style={styles.qrImage}
                contentFit="contain"
              />
            ) : (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 40 }} />
            )}
            <View style={styles.waitRow}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
              <Text style={[styles.waitText, { color: colors.mutedForeground }]}>En attente du scan…</Text>
            </View>
            <TouchableOpacity
              style={[styles.btnOutline, { borderColor: colors.border }]}
              onPress={handleConnect}
              activeOpacity={0.8}
            >
              <Feather name="refresh-cw" size={14} color={colors.foreground} />
              <Text style={[styles.btnOutlineText, { color: colors.foreground }]}>Actualiser le QR</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'connected' && (
          <View style={styles.connectedSection}>
            {/* History importing */}
            {historyImporting && (
              <View style={[styles.historyImportBanner, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                <ActivityIndicator size="small" color="#2563EB" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyImportTitle}>Import de l'historique…</Text>
                  <Text style={styles.historyImportSub}>{historyImporting.total} messages à traiter</Text>
                </View>
              </View>
            )}
            {/* History done */}
            {historyDone && historyDone.imported > 0 && (
              <View style={[styles.historyDoneBanner, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                <Feather name="check-circle" size={15} color="#059669" />
                <Text style={styles.historyDoneText}>{historyDone.imported} messages importés</Text>
              </View>
            )}

            <View style={[styles.connectedBadge, { backgroundColor: '#D1FAE5', borderColor: '#A7F3D0' }]}>
              <Feather name="check-circle" size={20} color="#065F46" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.connectedTitle, { color: '#065F46' }]}>WhatsApp connecté ✓</Text>
                <Text style={[styles.connectedSub, { color: '#047857' }]}>
                  Les messages de {contactName} arrivent en temps réel
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.btnDanger, { borderColor: '#FECACA' }]}
              onPress={handleDisconnect}
              disabled={disconnecting}
              activeOpacity={0.8}
            >
              {disconnecting
                ? <ActivityIndicator size="small" color="#DC2626" />
                : <Feather name="wifi-off" size={15} color="#DC2626" />
              }
              <Text style={styles.btnDangerText}>Déconnecter</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
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
    gap: 10,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  content: { padding: 16, gap: 14 },
  infoBox: {
    borderRadius: 14, padding: 14, borderWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  infoTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  card: {
    borderRadius: 16, padding: 20, borderWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  cardCenter: { alignItems: 'center' },
  cardTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  cardSub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  warnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  warnText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15,
  },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  historyRow: {
    flexDirection: 'row', gap: 6,
  },
  historyChip: {
    borderWidth: 1, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 4,
    alignItems: 'center', gap: 2,
  },
  historyChipLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  historyChipSub: { fontSize: 9, fontFamily: 'Inter_400Regular' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 12,
  },
  btnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  qrImage: { width: 220, height: 220, borderRadius: 12 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  btnOutline: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  btnOutlineText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  connectedSection: { gap: 12 },
  historyImportBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  historyImportTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#1D4ED8' },
  historyImportSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#3B82F6', marginTop: 2 },
  historyDoneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
  },
  historyDoneText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#059669' },
  connectedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
  },
  connectedTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  connectedSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  btnDanger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 12,
  },
  btnDangerText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#DC2626' },
});
