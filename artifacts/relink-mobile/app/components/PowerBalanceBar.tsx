/**
 * PowerBalanceBar — rapport de force entre l'utilisateur et son contact.
 * Score 0-100 : 0 = contact a tout le pouvoir, 100 = utilisateur a tout le pouvoir.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/expo';

const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

type PowerBalance = {
  score: number;
  label: string;
  trend: 'up' | 'down' | 'stable';
  detail: string;
};

type Props = {
  relationId: number;
  contactName: string;
};

export function PowerBalanceBar({ relationId, contactName }: Props) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [data, setData] = useState<PowerBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`https://${domain}/api/relations/${relationId}/power-balance`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      setData(json);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [relationId]);

  const score = data?.score ?? 50;
  // score → split: contact gets (100-score), user gets score
  const contactFlex = 100 - score;
  const userFlex = score;

  const CONTACT_COLOR = '#EF4444';
  const USER_COLOR = '#10B981';

  const trendIcon = data?.trend === 'up' ? 'trending-up' : data?.trend === 'down' ? 'trending-down' : 'minus';
  const trendColor = data?.trend === 'up' ? USER_COLOR : data?.trend === 'down' ? CONTACT_COLOR : colors.mutedForeground;

  const barColor = score >= 55 ? USER_COLOR : score <= 45 ? CONTACT_COLOR : '#F59E0B';

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.muted, borderBottomColor: colors.border }]}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
    >
      {/* Row: contact name — label — Moi */}
      <View style={styles.row}>
        <Text style={[styles.nameTiny, { color: CONTACT_COLOR }]} numberOfLines={1}>
          {contactName.split(' ')[0]}
        </Text>

        <View style={styles.centerCol}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.accent} style={{ height: 16 }} />
          ) : (
            <View style={styles.labelRow}>
              <Feather name={trendIcon} size={11} color={trendColor} />
              <Text style={[styles.labelText, { color: colors.foreground }]}>
                {data?.label ?? 'Rapport de force'}
              </Text>
            </View>
          )}
        </View>

        <Text style={[styles.nameTiny, { color: USER_COLOR, textAlign: 'right' }]}>
          Moi
        </Text>
      </View>

      {/* Bar */}
      <View style={styles.barWrap}>
        <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
          {!loading && (
            <>
              <View style={[styles.barSegment, { flex: contactFlex, backgroundColor: CONTACT_COLOR + '55' }]} />
              <View style={[styles.barDivider, { backgroundColor: colors.background }]} />
              <View style={[styles.barSegment, { flex: userFlex, backgroundColor: USER_COLOR + '55' }]} />
            </>
          )}
        </View>
        {/* Score dot */}
        {!loading && (
          <View
            pointerEvents="none"
            style={[
              styles.scoreDot,
              {
                backgroundColor: barColor,
                left: `${score}%` as any,
                marginLeft: -6,
              },
            ]}
          />
        )}
      </View>

      {/* Score numbers */}
      {!loading && (
        <View style={styles.numRow}>
          <Text style={[styles.pct, { color: CONTACT_COLOR }]}>{100 - score}%</Text>
          <Text style={[styles.pct, { color: USER_COLOR }]}>{score}%</Text>
        </View>
      )}

      {/* Expanded detail */}
      {expanded && data?.detail ? (
        <View style={[styles.detailBox, { borderTopColor: colors.border }]}>
          <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
            {data.detail}
          </Text>
          <TouchableOpacity onPress={load} style={styles.refreshBtn}>
            <Feather name="refresh-cw" size={12} color={colors.accent} />
            <Text style={[styles.refreshText, { color: colors.accent }]}>Actualiser</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 7,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameTiny: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    width: 52,
  },
  centerCol: {
    flex: 1,
    alignItems: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  labelText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  barWrap: {
    position: 'relative',
    marginVertical: 2,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  barSegment: {
    height: 6,
  },
  barDivider: {
    width: 2,
    height: 6,
  },
  scoreDot: {
    position: 'absolute',
    top: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  numRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pct: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  detailBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  detailText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    lineHeight: 15,
    fontStyle: 'italic',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  refreshText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
});
