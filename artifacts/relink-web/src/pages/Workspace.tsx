import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  useGetRelation,
  useListMessages,
  useListAgentSessions,
  useGetAgentSession,
  useCreateAgentSession,
} from "@workspace/api-client-react";
import {
  Bot,
  Send,
  Search,
  Sparkles,
  MessageSquarePlus,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
};

function parseSSELine(line: string): { content?: string; done?: boolean; error?: string; contextUsed?: string[] } {
  if (!line.startsWith("data: ")) return {};
  try { return JSON.parse(line.slice(6)); } catch { return {}; }
}

export default function Workspace() {
  const params = useParams();
  const relationId = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [activeMessageId, setActiveMessageId] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "agent">("chat");

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [contextLabel, setContextLabel] = useState("Contexte actif");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedConversation, setPastedConversation] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Data
  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const { data: messagesData, isLoading: messagesLoading } = useListMessages(
    relationId,
    { query: { enabled: !!relationId } }
  );
  const { data: sessions } = useListAgentSessions(relationId, { query: { enabled: !!relationId } });
  const activeSessionId = sessions?.[0]?.id;
  const { data: sessionData } = useGetAgentSession(
    relationId,
    activeSessionId!,
    { query: { enabled: !!relationId && !!activeSessionId } }
  );
  const createSession = useCreateAgentSession();

  // Create session if none
  useEffect(() => {
    if (sessions && sessions.length === 0 && !createSession.isPending) {
      createSession.mutate({ relationId, data: { title: "Nouvelle analyse" } });
    }
  }, [sessions]);

  // Seed local messages from session data on first load
  useEffect(() => {
    if (sessionData?.messages && localMessages.length === 0) {
      setLocalMessages(
        sessionData.messages.map((m) => ({
          id: String(m.id),
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
    }
  }, [sessionData]);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [localMessages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || !activeSessionId) return;

    setChatInput("");
    const pasteCopy = pastedConversation.trim();
    if (pasteCopy) {
      setPastedConversation("");
      setPasteOpen(false);
    }

    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;

    // Show pasted context inline in user bubble if any
    const displayContent = pasteCopy
      ? `${trimmed}\n\n[Conversation collée — ${pasteCopy.split("\n").length} lignes]`
      : trimmed;

    setLocalMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: displayContent },
      { id: assistantId, role: "assistant", content: "", isStreaming: true },
    ]);
    setIsStreaming(true);

    try {
      const res = await fetch(
        `/api/relations/${relationId}/agent/sessions/${activeSessionId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            selectedMessageIds: activeMessageId ? [activeMessageId] : undefined,
            pastedConversation: pasteCopy || undefined,
          }),
        }
      );

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          for (const line of part.split("\n")) {
            const parsed = parseSSELine(line);
            if (parsed.contextUsed?.length) {
              setContextLabel(parsed.contextUsed.join(" · "));
            }
            if (parsed.content) {
              setLocalMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + parsed.content }
                    : m
                )
              );
            }
            if (parsed.done) {
              setLocalMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, isStreaming: false } : m
                )
              );
            }
            if (parsed.error) {
              setLocalMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: parsed.error!, isStreaming: false }
                    : m
                )
              );
            }
          }
        }
      }
    } catch {
      toast({ title: "Erreur de connexion", description: "Impossible de joindre l'agent.", variant: "destructive" });
      setLocalMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Une erreur est survenue. Réessayez.", isStreaming: false }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      setActiveMessageId(null);
    }
  }, [isStreaming, activeSessionId, relationId, activeMessageId, pastedConversation, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput);
    }
  };

  const QUICK_CHIPS = [
    "Schémas répétitifs ?",
    "Ai-je été trop agressif ?",
    "Comment poser mes limites ?",
    "Que veut dire ce message ?",
    "Propose une réponse",
  ];

  if (!relation) return (
    <div className="p-12 flex justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="flex h-full w-full bg-background overflow-hidden relative">
      {/* Mobile Tabs */}
      <div className="md:hidden absolute top-0 left-0 right-0 z-10 bg-background/80 backdrop-blur-md border-b flex px-4">
        <button
          onClick={() => setMobileTab("chat")}
          className={cn("flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
            mobileTab === "chat" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
        >
          Conversation
        </button>
        <button
          onClick={() => setMobileTab("agent")}
          className={cn("flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
            mobileTab === "agent" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
        >
          Agent ReLink
        </button>
      </div>

      {/* Left — WhatsApp viewer */}
      <div className={cn(
        "flex-1 md:flex-[1.2] lg:flex-1 flex-col border-r bg-card/30 h-full",
        mobileTab === "chat" ? "flex" : "hidden md:flex"
      )}>
        <div className="h-16 mt-10 md:mt-0 px-4 flex items-center justify-between border-b bg-background/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-medium text-muted-foreground">
              {relation.participantOther.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-medium">{relation.participantOther}</div>
              <div className="text-xs text-muted-foreground">{messagesData?.total ?? 0} messages</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground">
            <Search className="h-5 w-5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4 max-w-2xl mx-auto pb-8 pt-4">
            {messagesLoading ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : messagesData?.messages?.length === 0 ? (
              <div className="text-center p-12 text-muted-foreground space-y-4">
                <MessageSquarePlus className="h-8 w-8 mx-auto opacity-50" />
                <p>Aucun message. Importez une conversation pour commencer.</p>
                <Button
                  onClick={() => setLocation(`/relations/${relationId}/import`)}
                  variant="outline"
                  className="rounded-full"
                >
                  Importer
                </Button>
              </div>
            ) : (
              messagesData?.messages.map((msg, i) => {
                const showDate =
                  i === 0 ||
                  new Date(msg.sentAt).getDate() !==
                    new Date(messagesData.messages[i - 1].sentAt).getDate();
                const isSelected = activeMessageId === msg.id;

                return (
                  <div key={msg.id} className="space-y-4">
                    {showDate && (
                      <div className="flex justify-center">
                        <span className="px-3 py-1 bg-muted rounded-full text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {format(new Date(msg.sentAt), "dd MMMM yyyy", { locale: fr })}
                        </span>
                      </div>
                    )}
                    <div className={cn("flex", msg.isMe ? "justify-end" : "justify-start")}>
                      <div
                        onClick={() => {
                          setActiveMessageId(isSelected ? null : msg.id);
                          if (!isSelected && window.innerWidth < 768) setMobileTab("agent");
                        }}
                        className={cn(
                          "relative max-w-[85%] md:max-w-[75%] px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed cursor-pointer transition-all select-none",
                          msg.isMe
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-background border rounded-tl-sm",
                          isSelected && "ring-2 ring-amber-400 ring-offset-2 ring-offset-background"
                        )}
                      >
                        {!msg.isMe && (
                          <div className="text-[11px] font-semibold text-amber-600 mb-1">{msg.sender}</div>
                        )}
                        {msg.content}
                        <div className={cn(
                          "text-[10px] mt-1.5 text-right",
                          msg.isMe ? "text-primary-foreground/60" : "text-muted-foreground"
                        )}>
                          {format(new Date(msg.sentAt), "HH:mm")}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right — Agent */}
      <div className={cn(
        "flex-1 flex-col h-full bg-background relative",
        mobileTab === "agent" ? "flex" : "hidden md:flex"
      )}>
        <div className="h-16 mt-10 md:mt-0 px-6 flex items-center justify-between border-b shrink-0">
          <div className="flex items-center gap-3 text-primary">
            <Bot className="h-5 w-5" />
            <span className="font-serif font-medium text-lg">Agent ReLink</span>
          </div>
          <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground font-medium">
            {contextLabel}
          </span>
        </div>

        {/* Messages */}
        <div className="relative flex-1 min-h-0">
          {/* Top fade — évite que les messages accrochent visuellement au header */}
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-8 z-10 bg-gradient-to-b from-background to-transparent" />
        <div ref={scrollRef} className="h-full overflow-y-auto p-4 md:p-6 space-y-6 pb-48 pt-6">
          <AgentBubble content="Je suis là pour analyser ces échanges avec vous. Sélectionnez un message ou posez une question générale." />

          {localMessages.map((msg) =>
            msg.role === "assistant" ? (
              <AgentBubble key={msg.id} content={msg.content} isStreaming={msg.isStreaming} />
            ) : (
              <UserBubble key={msg.id} content={msg.content} />
            )
          )}

          {activeMessageId && (
            <div className="animate-in fade-in slide-in-from-bottom-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-amber-700 mb-3 text-sm font-medium">
                <Sparkles className="h-4 w-4" />
                Message sélectionné — inclus dans le prochain envoi
              </div>
              <p className="text-sm text-muted-foreground italic mb-3 line-clamp-3">
                "{messagesData?.messages?.find((m) => m.id === activeMessageId)?.content}"
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setActiveMessageId(null)}
                className="rounded-full text-xs h-7 px-3"
              >
                Désélectionner
              </Button>
            </div>
          )}
        </div>
        </div>{/* end relative wrapper */}

        {/* Input */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background/95 to-transparent pt-8 pb-4 px-4 md:px-6">
          <div className="max-w-2xl mx-auto space-y-2">

            {/* Paste panel */}
            {pasteOpen && (
              <div className="animate-in slide-in-from-bottom-2 fade-in bg-card border border-amber-200 rounded-2xl overflow-hidden shadow-md">
                <div className="flex items-center justify-between px-4 py-2 border-b border-amber-100 bg-amber-50/60">
                  <span className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Conversation collée — l'agent lira tout ce texte
                  </span>
                  <button
                    onClick={() => { setPasteOpen(false); setPastedConversation(""); }}
                    className="text-amber-600 hover:text-amber-900 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Textarea
                  autoFocus
                  placeholder={"Colle ici ta conversation WhatsApp, iMessage, SMS…\n\nEx :\n14/07/2025 18:42 - Alex : T'as vu mon message ?\nMoi : Oui désolé j'étais occupé"}
                  className="min-h-[160px] max-h-64 resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent text-[13px] leading-relaxed font-mono p-4"
                  value={pastedConversation}
                  onChange={(e) => setPastedConversation(e.target.value)}
                />
                {pastedConversation.trim() && (
                  <div className="px-4 py-2 border-t border-amber-100 text-[11px] text-amber-700">
                    {pastedConversation.trim().split("\n").filter(Boolean).length} lignes prêtes · pose ta question ci-dessous puis envoie
                  </div>
                )}
              </div>
            )}

            {/* Quick chips */}
            <div className="flex overflow-x-auto gap-2 pb-1 scrollbar-none">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => sendMessage(chip)}
                  disabled={isStreaming || !activeSessionId}
                  className="shrink-0 px-3 py-1.5 bg-card border rounded-full text-xs hover:bg-muted transition-colors whitespace-nowrap disabled:opacity-40"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="relative flex items-end bg-card border rounded-2xl p-2 shadow-sm focus-within:ring-1 focus-within:ring-primary/30 transition-shadow">
              {/* Paste toggle button */}
              <button
                onClick={() => setPasteOpen((o) => !o)}
                disabled={isStreaming || !activeSessionId}
                className={cn(
                  "self-end mb-1.5 ml-1 mr-1 h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0",
                  pasteOpen || pastedConversation
                    ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title="Coller une conversation"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <Textarea
                ref={textareaRef}
                placeholder={pastedConversation ? "Ta question sur la conversation collée…" : "Pose une question à ReLink… (Entrée pour envoyer)"}
                className="min-h-[44px] max-h-32 resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent py-3 text-[15px] flex-1"
                rows={1}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming || !activeSessionId}
              />
              <Button
                size="icon"
                className="rounded-full h-10 w-10 shrink-0 mb-1 mr-1"
                onClick={() => sendMessage(chatInput)}
                disabled={!chatInput.trim() || isStreaming || !activeSessionId}
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 ml-0.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentBubble({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="flex gap-4 max-w-3xl">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary mt-1 border border-primary/20">
        {isStreaming ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>
      <div className="space-y-1 flex-1">
        <div className="text-sm font-medium text-primary">ReLink</div>
        <div className="text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {content}
          {isStreaming && <span className="inline-block w-[2px] h-4 bg-primary ml-0.5 animate-pulse align-middle" />}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-4 max-w-3xl ml-auto">
      <div className="bg-muted px-5 py-3 rounded-2xl rounded-tr-sm text-[15px] leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
