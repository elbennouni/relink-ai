/**
 * SosPendingToast — petit bandeau qui apparaît en bas de l'écran quand une
 * réponse SOS automatique est programmée. L'utilisateur peut l'annuler avant
 * qu'elle ne parte.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated, TouchableOpacity, Text, View, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/expo';

const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

type SosDraft = {
  id: number;
  content: string;
  scheduledAt: string;
};

type Props = {
  relationId: number;
  /** offset bottom so the toast sits above the input bar */
  bottomOffset?: number;
};

function useCountdown(scheduledAt: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!scheduledAt) { setRemaining(null); return; }
    const tick = () => {
      const ms = new Date(scheduledAt).getTime() - Date.now();
      setRemaining(Math.max(0, ms));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [scheduledAt]);

  return remaining;
}

function formatCountdown(ms: number | null) {
  if (ms === null) return '';
  if (ms <= 0) return 'envoi en cours…';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `dans ${h}h ${m.toString().padStart(2, '0')}min`;
  if (m > 0) return `dans ${m}min ${s.toString().padStart(2, '0')}s`;
  return `dans ${s}s`;
}

export function SosPendingToast({ relationId, bottomOffset = 100 }: Props) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [draft, setDraft] = useState<SosDraft | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const slideAnim = useRef(new Animated.Value(120)).current;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const remaining = useCountdown(draft?.scheduledAt ?? null);

  // ── Slide in / out ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (draft) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: 120, duration: 220, useNativeDriver: true }).start();
    }
  }, [!!draft]);

  // ── Polling every 10 s ──────────────────────────────────────────────────────
  const fetchPending = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(
        `https://${domain}/api/relations/${relationId}/messages/sos-pending`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) return;
      const data = await res.json();
      setDraft(data.pending ?? null);
    } catch { /* ignore */ }
  }, [getToken, relationId]);

  useEffect(() => {
    fetchPending();
    pollRef.current = setInterval(fetchPending, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchPending]);

  // ── Cancel ──────────────────────────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (!draft || cancelling) return;
    setCancelling(true);
    try {
      const token = await getToken();
      await fetch(
        `https://${domain}/api/relations/${relationId}/messages/scheduled/${draft.id}/cancel-sos`,
        { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setDraft(null);
    } catch { /* ignore */ } finally {
      setCancelling(false);
    }
  }, [draft, cancelling, getToken, relationId]);

  if (!draft) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: bottomOffset,
          transform: [{ translateY: slideAnim }],
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: colors.foreground,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.sosBadge, { backgroundColor: '#ef4444' + '22' }]}>
          <Feather name="shield" size={11} color="#ef4444" />
          <Text style={[styles.sosBadgeText, { color: '#ef4444' }]}>SOS auto</Text>
        </View>
        <Text style={[styles.countdown, { color: colors.mutedForeground }]}>
          {formatCountdown(remaining)}
        </Text>
      </View>

      {/* Message preview */}
      <Text style={[styles.preview, { color: colors.foreground }]} numberOfLines={2}>
        {draft.content}
      </Text>

      {/* Cancel button */}
      <TouchableOpacity
        style={[styles.cancelBtn, { borderColor: colors.border }]}
        onPress={handleCancel}
        activeOpacity={0.7}
        disabled={cancelling}
      >
        {cancelling
          ? <ActivityIndicator size="small" color={colors.mutedForeground} />
          : <>
              <Feather name="x" size={13} color={colors.mutedForeground} />
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Annuler l'envoi</Text>
            </>
        }
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 999,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sosBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  sosBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },
  countdown: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  preview: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  cancelText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
});
