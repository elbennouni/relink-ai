import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  useGetRelation,
  useListAgentSessions,
  useCreateAgentSession,
  useGetAgentSession,
} from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { fetch } from 'expo/fetch';

const QUICK_CHIPS = [
  'Analyse le dernier message',
  'Dois-je répondre maintenant ?',
  'Propose une réponse',
  'Quels schémas se répètent ?',
  'Résume la situation',
];

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
};

function parseSSE(chunk: string): { content?: string; done?: boolean; error?: string } {
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        return data;
      } catch { }
    }
  }
  return {};
}

export default function AgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationId = Number(id);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [contextLabel, setContextLabel] = useState('Mémoire · Messages récents');
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const { data: sessions } = useListAgentSessions(relationId, { query: { enabled: !!relationId } });
  const createSession = useCreateAgentSession();

  // Auto-create or select a session
  useEffect(() => {
    if (!sessions) return;
    if (sessions.length > 0 && !sessionId) {
      setSessionId(sessions[0].id);
    } else if (sessions.length === 0 && !sessionId && relation) {
      createSession.mutateAsync({
        relationId,
        data: { title: `Session — ${new Date().toLocaleDateString('fr-FR')}` },
      }).then((s) => setSessionId(s.id)).catch(() => { });
    }
  }, [sessions, relation, sessionId]);

  // Load existing session messages
  const { data: sessionData } = useGetAgentSession(
    relationId,
    sessionId ?? 0,
    { query: { enabled: !!sessionId } }
  );

  useEffect(() => {
    if (!sessionData?.messages || messages.length > 0) return;
    setMessages(sessionData.messages.map((m) => ({
      id: String(m.id),
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })));
  }, [sessionData]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming || !sessionId) return;
    const trimmed = text.trim();
    setInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      const response = await fetch(
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/relations/${relationId}/agent/sessions/${sessionId}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
        }
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
          if (parsed.contextUsed && Array.isArray(parsed.contextUsed)) {
            setContextLabel(parsed.contextUsed.join(' · ') || contextLabel);
          }
          if (parsed.content) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + parsed.content }
                  : m
              )
            );
          }
          if (parsed.done) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, isStreaming: false } : m
              )
            );
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Une erreur est survenue. Réessayez.", isStreaming: false }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, sessionId, relationId, contextLabel]);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAssistant]}>
        {!isUser && (
          <View style={[styles.botAvatar, { backgroundColor: colors.accent }]}>
            <Feather name="zap" size={12} color="#fff" />
          </View>
        )}
        <View
          style={[
            styles.bubble,
            isUser
              ? [styles.bubbleUser, { backgroundColor: colors.primary }]
              : [styles.bubbleAssistant, { backgroundColor: colors.card, borderColor: colors.border }],
          ]}
        >
          <Text style={[styles.bubbleText, { color: isUser ? colors.primaryForeground : colors.foreground }]}>
            {item.content}
            {item.isStreaming && <Text style={{ color: colors.accent }}>▊</Text>}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.botAvatarLarge, { backgroundColor: colors.accent }]}>
        <Feather name="zap" size={24} color="#fff" />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>ReLink AI</Text>
      <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
        Posez une question sur votre relation.{'\n'}
        Je connais votre contexte et votre historique.
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Context pill */}
      <View style={[styles.contextBar, { borderBottomColor: colors.border }]}>
        <View style={[styles.contextPill, { backgroundColor: colors.muted }]}>
          <Feather name="layers" size={11} color={colors.mutedForeground} />
          <Text style={[styles.contextText, { color: colors.mutedForeground }]}>{contextLabel}</Text>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          !messages.length && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Quick chips */}
      {messages.length === 0 && (
        <FlatList
          data={QUICK_CHIPS}
          horizontal
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => sendMessage(item)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, { color: colors.foreground }]}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Input */}
      <View style={[styles.inputContainer, { borderTopColor: colors.border, paddingBottom: bottomPad + 8, backgroundColor: colors.background }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          placeholder="Posez une question..."
          placeholderTextColor={colors.mutedForeground}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={() => sendMessage(input)}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: input.trim() && !isStreaming ? colors.primary : colors.muted }]}
          onPress={() => sendMessage(input)}
          disabled={!input.trim() || isStreaming}
          activeOpacity={0.85}
        >
          {isStreaming ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Feather name="send" size={18} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contextBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  contextPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  contextText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  listContentEmpty: { flex: 1 },
  msgRow: {
    flexDirection: 'row',
    gap: 8,
    maxWidth: '85%',
  },
  msgRowUser: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  msgRowAssistant: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  botAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    flexShrink: 0,
  },
  botAvatarLarge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexShrink: 1,
  },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAssistant: {
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  chipsContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
