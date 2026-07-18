import { useEffect, useState, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  useGetRelation,
  useListMessages,
  useListAgentSessions,
  useGetAgentSession,
  useCreateAgentSession,
  useGetSuggestions,
  useTransformSuggestion,
  AgentMessage
} from "@workspace/api-client-react";
import { 
  Bot, 
  Send, 
  MoreVertical, 
  Copy, 
  RefreshCcw, 
  Search, 
  ChevronLeft,
  Sparkles,
  MessageSquarePlus,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

export default function Workspace() {
  const params = useParams();
  const relationId = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [activeMessageId, setActiveMessageId] = useState<number | null>(null);
  
  // Data Queries
  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  
  const { data: messagesData, isLoading: messagesLoading } = useListMessages(
    relationId, 
    { query: { enabled: !!relationId, params: { limit: 50 } } }
  );

  const { data: sessions } = useListAgentSessions(relationId, { query: { enabled: !!relationId } });
  const activeSessionId = sessions?.[0]?.id; // Just grab the most recent one for now
  
  const { data: sessionData } = useGetAgentSession(
    relationId, 
    activeSessionId!, 
    { query: { enabled: !!relationId && !!activeSessionId } }
  );

  const createSession = useCreateAgentSession();
  
  // Create a session if none exists
  useEffect(() => {
    if (sessions && sessions.length === 0 && !createSession.isPending) {
      createSession.mutate({
        relationId,
        data: { title: "Nouvelle analyse" }
      });
    }
  }, [sessions]);

  // Mobile layout state
  const [mobileTab, setMobileTab] = useState<'chat' | 'agent'>('chat');

  if (!relation) return <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex h-full w-full bg-background overflow-hidden relative">
      {/* Mobile Tabs */}
      <div className="md:hidden absolute top-0 left-0 right-0 z-10 bg-background/80 backdrop-blur-md border-b flex px-4 pt-safe">
        <button 
          onClick={() => setMobileTab('chat')}
          className={cn("flex-1 py-3 text-sm font-medium border-b-2 transition-colors", mobileTab === 'chat' ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
        >
          Conversation
        </button>
        <button 
          onClick={() => setMobileTab('agent')}
          className={cn("flex-1 py-3 text-sm font-medium border-b-2 transition-colors", mobileTab === 'agent' ? "border-secondary text-primary" : "border-transparent text-muted-foreground")}
        >
          Agent ReLink
        </button>
      </div>

      {/* Left Column - WhatsApp Viewer */}
      <div className={cn(
        "flex-1 md:flex-[1.2] lg:flex-1 flex-col border-r bg-card/30 h-full",
        mobileTab === 'chat' ? "flex" : "hidden md:flex"
      )}>
        {/* Header */}
        <div className="h-16 md:h-16 mt-12 md:mt-0 px-4 flex items-center justify-between border-b bg-background/50 backdrop-blur-sm z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-medium text-muted-foreground">
              {relation.participantOther.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-medium">{relation.participantOther}</div>
              <div className="text-xs text-muted-foreground">
                {messagesData?.total || 0} messages
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground">
            <Search className="h-5 w-5" />
          </Button>
        </div>

        {/* Messages Scroll Area */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4 max-w-2xl mx-auto pb-8 pt-4">
            {messagesLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : messagesData?.messages?.length === 0 ? (
              <div className="text-center p-12 text-muted-foreground space-y-4">
                <MessageSquarePlus className="h-8 w-8 mx-auto opacity-50" />
                <p>Aucun message. Importez une conversation pour commencer.</p>
                <Button onClick={() => setLocation(`/relations/${relationId}/import`)} variant="outline" className="rounded-full">
                  Importer
                </Button>
              </div>
            ) : (
              messagesData?.messages.map((msg, i) => {
                const showDate = i === 0 || new Date(msg.sentAt).getDate() !== new Date(messagesData.messages[i-1].sentAt).getDate();
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
                    <div 
                      className={cn(
                        "flex", 
                        msg.isMe ? "justify-end" : "justify-start"
                      )}
                    >
                      <div 
                        onClick={() => {
                          setActiveMessageId(isSelected ? null : msg.id);
                          if (!isSelected && window.innerWidth < 768) {
                            setMobileTab('agent');
                          }
                        }}
                        className={cn(
                          "relative max-w-[85%] md:max-w-[75%] px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed cursor-pointer transition-all",
                          msg.isMe 
                            ? "bg-primary text-primary-foreground rounded-tr-sm" 
                            : "bg-background border rounded-tl-sm",
                          isSelected && "ring-2 ring-secondary ring-offset-2 ring-offset-background"
                        )}
                      >
                        {msg.content}
                        <div className={cn(
                          "text-[10px] mt-1.5 text-right",
                          msg.isMe ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}>
                          {format(new Date(msg.sentAt), "HH:mm")}
                        </div>
                        
                        {/* Hover/Select Actions */}
                        {isSelected && (
                          <div className={cn(
                            "absolute top-1/2 -translate-y-1/2 flex items-center gap-1",
                            msg.isMe ? "right-full mr-3" : "left-full ml-3"
                          )}>
                            <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full shadow-sm animate-in zoom-in duration-200">
                              <Bot className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right Column - Agent */}
      <div className={cn(
        "flex-1 flex-col h-full bg-background relative",
        mobileTab === 'agent' ? "flex" : "hidden md:flex"
      )}>
        <div className="h-16 md:h-16 mt-12 md:mt-0 px-6 flex items-center justify-between border-b">
          <div className="flex items-center gap-3 text-primary">
            <Bot className="h-5 w-5" />
            <span className="font-serif font-medium text-lg">Agent ReLink</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground font-medium">
              Contexte actif
            </span>
          </div>
        </div>

        <ScrollArea className="flex-1 p-4 md:p-6">
          <div className="space-y-6 pb-32">
            {/* Welcome message */}
            <AgentBubble content="Je suis là pour vous aider à analyser ces échanges. Vous pouvez sélectionner un message précis ou me poser une question générale sur la relation." />
            
            {sessionData?.messages?.map(msg => (
              msg.role === 'assistant' 
                ? <AgentBubble key={msg.id} content={msg.content} />
                : <UserBubble key={msg.id} content={msg.content} />
            ))}
            
            {/* Active Analysis UI if message is selected */}
            {activeMessageId && (
              <div className="animate-in fade-in slide-in-from-bottom-4 bg-secondary/5 border border-secondary/20 rounded-2xl p-4 mt-6">
                <div className="flex items-center gap-2 text-secondary-foreground mb-3 text-sm font-medium">
                  <Sparkles className="h-4 w-4" />
                  Message sélectionné
                </div>
                <p className="text-sm text-muted-foreground italic mb-4">
                  "{messagesData?.messages?.find(m => m.id === activeMessageId)?.content}"
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" className="rounded-full text-xs">Que veut dire ce message ?</Button>
                  <Button size="sm" variant="outline" className="rounded-full text-xs bg-background">Proposer une réponse</Button>
                  <Button size="sm" variant="ghost" onClick={() => setActiveMessageId(null)} className="rounded-full text-xs">Annuler</Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Chat Input */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background to-transparent pt-10 pb-4 px-4 md:px-6">
          <div className="max-w-2xl mx-auto space-y-3">
            {/* Quick Chips */}
            <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-none hide-scrollbar">
              <span className="shrink-0 px-3 py-1.5 bg-card border rounded-full text-xs cursor-pointer hover:bg-muted whitespace-nowrap">Schémas répétitifs ?</span>
              <span className="shrink-0 px-3 py-1.5 bg-card border rounded-full text-xs cursor-pointer hover:bg-muted whitespace-nowrap">Ai-je été trop agressif ?</span>
              <span className="shrink-0 px-3 py-1.5 bg-card border rounded-full text-xs cursor-pointer hover:bg-muted whitespace-nowrap">Comment poser mes limites ?</span>
            </div>
            
            <div className="relative flex items-end bg-card border rounded-2xl p-2 shadow-sm focus-within:ring-1 focus-within:ring-primary/20 transition-shadow">
              <Textarea 
                placeholder="Posez une question à ReLink..." 
                className="min-h-[44px] max-h-32 resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent py-3 text-[15px]"
                rows={1}
              />
              <Button size="icon" className="rounded-full h-10 w-10 shrink-0 mb-1 mr-1">
                <Send className="h-4 w-4 ml-0.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentBubble({ content }: { content: string }) {
  return (
    <div className="flex gap-4 max-w-3xl">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary mt-1 border border-primary/20">
        <Bot className="h-4 w-4" />
      </div>
      <div className="space-y-2 flex-1">
        <div className="text-sm font-medium text-primary">ReLink</div>
        <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-[15px] leading-relaxed text-foreground/90">
          {content}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-4 max-w-3xl ml-auto">
      <div className="bg-muted px-5 py-3 rounded-2xl rounded-tr-sm text-[15px] leading-relaxed">
        {content}
      </div>
    </div>
  );
}
