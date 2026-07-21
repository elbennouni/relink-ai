import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Wand2, Copy, CornerDownRight, RefreshCw, Send, SmartphoneNfc,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScheduleTimerPopover } from "@/components/ScheduleTimerPopover";

type Suggestion = { text: string; label: string; score?: number; scoreLabel?: string };
type ContextMsg = { sender: string; content: string; isMe: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  relationId: number;
  contactName: string;
  contactPhone?: string;
  waConnected: boolean;
  onPasteToAgent: (text: string) => void;
};


function ScoreBar({ score, label }: { score: number; label?: string }) {
  const color =
    score >= 70 ? "bg-emerald-500" :
    score >= 40 ? "bg-amber-500" :
    "bg-rose-500";

  return (
    <div className="flex items-center gap-2 mt-1 mb-2.5">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn(
        "text-[10px] font-bold tabular-nums",
        score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-rose-600"
      )}>
        {score}
      </span>
      {label && (
        <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
      )}
    </div>
  );
}

export function SuggestRepliesDialog({
  open, onClose, relationId, contactName, contactPhone, waConnected, onPasteToAgent,
}: Props) {
  const [intent, setIntent] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [context, setContext] = useState<ContextMsg[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [scheduled, setScheduled] = useState<{ i: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSent(null);
    setScheduled(null);
    try {
      const res = await fetch(`/api/relations/${relationId}/suggest-replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setContext(data.context ?? []);
    } catch {
      setError("Impossible de générer des suggestions. Réessaie.");
    } finally {
      setLoading(false);
    }
  }, [relationId, intent]);

  const handleSend = async (text: string, i: number, delayMinutes: number) => {
    setSending(i);
    setError(null);
    try {
      if (delayMinutes > 0) {
        // Scheduled send
        const res = await fetch(`/api/relations/${relationId}/messages/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, delayMinutes }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const label = delayMinutes >= 60 ? `${delayMinutes / 60}h` : `${delayMinutes} min`;
        setScheduled({ i, label });
        setTimeout(() => { setScheduled(null); onClose(); }, 1800);
      } else {
        // Immediate send via WhatsApp
        const res = await fetch(`/api/relations/${relationId}/whatsapp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        setSent(i);
        setTimeout(() => { setSent(null); onClose(); }, 1200);
      }
    } catch (e: unknown) {
      setError(`Envoi échoué : ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setSending(null);
    }
  };

  const handleCopy = (text: string, i: number) => {
    navigator.clipboard.writeText(text);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && suggestions.length === 0 && !loading) generate();
    if (!isOpen) onClose();
  };

  const displayPhone = contactPhone
    ? `+${contactPhone.slice(0, 2)} ${contactPhone.slice(2).replace(/(\d{1})(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5")}`
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg w-full p-0 gap-0 overflow-hidden rounded-2xl">
        <DialogHeader className="px-5 pt-5 pb-4 border-b bg-gradient-to-r from-violet-50 to-transparent">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Wand2 className="h-4 w-4 text-violet-500" />
            Générer une réponse WhatsApp
          </DialogTitle>
          <div className="mt-2 flex items-center gap-2">
            <SmartphoneNfc className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">
              Envoi à{" "}
              <span className="font-semibold text-foreground">{contactName}</span>
              {displayPhone && (
                <span className="ml-1 font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded-md">
                  {displayPhone}
                </span>
              )}
              {waConnected ? (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 rounded-full px-2 py-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
                  WhatsApp connecté
                </span>
              ) : (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  ⚠ WhatsApp non connecté
                </span>
              )}
            </span>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Contexte récent */}
          {context.length > 0 && (
            <div className="space-y-1.5 bg-muted/40 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Contexte récent
              </p>
              {context.map((m, i) => (
                <div key={i} className={cn("flex", m.isMe ? "justify-end" : "justify-start")}>
                  <span className={cn(
                    "text-[12px] px-2.5 py-1 rounded-xl max-w-[80%] leading-snug",
                    m.isMe
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-background border rounded-tl-sm text-foreground"
                  )}>
                    {m.content.startsWith("[Vocal]") ? "🎤 " + m.content.replace("[Vocal] ", "") : m.content}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Intent input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Ce que tu veux exprimer <span className="font-normal normal-case">(optionnel)</span>
            </label>
            <Textarea
              placeholder={`Ex : dire à ${contactName} que je suis occupé ce soir…`}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              className="resize-none text-sm min-h-[60px] rounded-xl"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } }}
            />
          </div>

          {/* Bouton générer */}
          <Button
            onClick={generate}
            disabled={loading}
            className="w-full rounded-xl font-medium"
            variant={suggestions.length > 0 ? "outline" : "default"}
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Génération…</>
            ) : suggestions.length > 0 ? (
              <><RefreshCw className="h-4 w-4 mr-2" />Regénérer</>
            ) : (
              <><Wand2 className="h-4 w-4 mr-2" />Générer des suggestions</>
            )}
          </Button>

          {error && <p className="text-xs text-destructive text-center">{error}</p>}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Suggestions — calquées sur ton style
              </p>
              {suggestions.map((s, i) => (
                <div key={i} className="bg-card border rounded-xl px-4 py-3 hover:border-violet-200 transition-all">
                  <span className="inline-block text-[10px] font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5 mb-1.5">
                    {s.label}
                  </span>

                  {/* Score bar */}
                  {typeof s.score === "number" && (
                    <ScoreBar score={s.score} label={s.scoreLabel} />
                  )}

                  <p className="text-[14px] leading-relaxed text-foreground whitespace-pre-wrap mb-3">{s.text}</p>

                  <div className="flex gap-1.5">
                    {/* Envoyer maintenant */}
                    <Button
                      size="sm"
                      onClick={() => handleSend(s.text, i, 0)}
                      disabled={!waConnected || sending === i}
                      className={cn(
                        "flex-1 h-8 text-xs rounded-lg gap-1.5",
                        sent === i && "bg-green-600 hover:bg-green-600"
                      )}
                      title={!waConnected ? "WhatsApp non connecté" : undefined}
                    >
                      {sending === i ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : sent === i ? (
                        "✓ Envoyé !"
                      ) : scheduled?.i === i ? (
                        `⏱ ${scheduled.label}`
                      ) : (
                        <><Send className="h-3.5 w-3.5" />Envoyer</>
                      )}
                    </Button>

                    {/* Timer de réponse */}
                    <ScheduleTimerPopover
                      compact
                      disabled={sending === i}
                      onSchedule={(m) => handleSend(s.text, i, m)}
                    />

                    {/* Copier */}
                    <Button size="sm" variant="outline" onClick={() => handleCopy(s.text, i)} className="h-8 px-3 text-xs rounded-lg">
                      {copied === i ? <span className="text-green-600">✓</span> : <Copy className="h-3.5 w-3.5" />}
                    </Button>

                    {/* Coller dans le chat agent */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { onPasteToAgent(s.text); onClose(); }}
                      className="h-8 px-3 text-xs rounded-lg text-muted-foreground hover:text-foreground"
                      title="Coller dans le chat agent"
                    >
                      <CornerDownRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
