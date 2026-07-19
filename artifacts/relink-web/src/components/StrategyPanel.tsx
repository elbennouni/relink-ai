import { useState } from "react";
import { Loader2, X, Shield, Send, Copy, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Option = {
  label: string;
  text: string | null;
  score: number;
  score_delta: string;
  reason: string;
  type: "silence" | "dominant" | "neutral" | "weak";
};

export type StrategyResult = {
  tactic?: string;
  tactique_label?: string;
  framework?: string;
  insight?: string;
  power_baseline?: number;
  options?: Option[];
  triggerMessage?: string;
  contact?: string;
};

type Props = {
  result: StrategyResult;
  isLoading: boolean;
  relationId: number;
  onDismiss: () => void;
  onSent: () => void;
};

const SCORE_COLOR = (score: number) => {
  if (score >= 7) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 3) return "text-amber-700 bg-amber-50 border-amber-200";
  if (score >= 0) return "text-slate-600 bg-slate-50 border-slate-200";
  return "text-red-600 bg-red-50 border-red-200";
};

const SCORE_BAR_COLOR = (score: number) => {
  if (score >= 7) return "bg-emerald-500";
  if (score >= 3) return "bg-amber-400";
  if (score >= 0) return "bg-slate-400";
  return "bg-red-400";
};

const TYPE_ICON: Record<string, string> = {
  silence: "🔇",
  dominant: "👑",
  neutral: "🪞",
  weak: "⚠️",
};

export function StrategyPanel({ result, isLoading, relationId, onDismiss, onSent }: Props) {
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const handleSend = async (text: string | null, i: number) => {
    if (text === null) {
      // Silence — just dismiss
      setSent(i);
      setTimeout(() => { onDismiss(); onSent(); }, 800);
      return;
    }
    setSending(i);
    setSendError(null);
    try {
      const res = await fetch(`/api/relations/${relationId}/whatsapp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSent(i);
      setTimeout(() => { onDismiss(); onSent(); }, 1000);
    } catch {
      setSendError("Envoi échoué — WhatsApp connecté ?");
    } finally {
      setSending(null);
    }
  };

  const handleCopy = (text: string, i: number) => {
    navigator.clipboard.writeText(text);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  };

  if (isLoading) {
    return (
      <div className="border-t bg-background/95 backdrop-blur-sm px-4 py-3 flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span>ReLink analyse le message entrant…</span>
      </div>
    );
  }

  if (!result.options) return null;

  return (
    <div className="border-t bg-background shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-primary/5 to-transparent border-b">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary shrink-0" />
          <div>
            <span className="text-[13px] font-semibold text-primary">Analyse ReLink</span>
            {result.tactique_label && (
              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {result.tactique_label}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={onDismiss}
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 py-3 space-y-3 max-h-[55vh] overflow-y-auto">
          {/* Message entrant */}
          {result.triggerMessage && (
            <div className="bg-muted/50 rounded-xl px-3 py-2 text-[13px] text-muted-foreground italic border-l-2 border-primary/30">
              « {result.triggerMessage} »
            </div>
          )}

          {/* Insight */}
          {result.insight && (
            <p className="text-[13px] text-foreground/80 leading-relaxed">
              {result.insight}
            </p>
          )}

          {/* Framework */}
          {result.framework && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span className="font-semibold text-primary">Cadre :</span>
              <span className="text-foreground/70">{result.framework}</span>
            </div>
          )}

          {/* Options */}
          <div className="space-y-2">
            {result.options.map((opt, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-xl border transition-all",
                  opt.type === "dominant" && "border-emerald-200 bg-emerald-50/50",
                  opt.type === "silence" && "border-emerald-200 bg-emerald-50/50",
                  opt.type === "neutral" && "border-border bg-card",
                  opt.type === "weak" && "border-red-100 bg-red-50/30",
                )}
              >
                <div className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base leading-none">{TYPE_ICON[opt.type]}</span>
                      <span className="text-[13px] font-semibold text-foreground">{opt.label}</span>
                    </div>
                    {/* Score badge */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Score bar */}
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", SCORE_BAR_COLOR(opt.score))}
                          style={{ width: `${Math.max(0, ((opt.score + 10) / 20) * 100)}%` }}
                        />
                      </div>
                      <span className={cn(
                        "text-[11px] font-bold px-1.5 py-0.5 rounded border",
                        SCORE_COLOR(opt.score)
                      )}>
                        {opt.score_delta} pouvoir
                      </span>
                    </div>
                  </div>

                  {/* Message text */}
                  {opt.text !== null ? (
                    <p className="text-[13px] text-foreground/80 leading-relaxed mb-2.5 pl-6">
                      {opt.text}
                    </p>
                  ) : (
                    <p className="text-[13px] text-muted-foreground italic mb-2.5 pl-6">
                      Ne pas répondre — laisser le silence parler
                    </p>
                  )}

                  {/* Raison — expandable */}
                  <button
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="pl-6 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expanded === i ? "▲ Moins" : "▾ Pourquoi ?"}
                  </button>
                  {expanded === i && (
                    <p className="pl-6 mt-1.5 text-[12px] text-muted-foreground leading-relaxed">
                      {opt.reason}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1.5 mt-2.5 pl-6">
                    <Button
                      size="sm"
                      onClick={() => handleSend(opt.text, i)}
                      disabled={sending === i}
                      className={cn(
                        "h-7 text-xs rounded-lg gap-1.5 flex-1",
                        opt.type === "weak"
                          ? "bg-muted text-foreground hover:bg-muted/80 border"
                          : "",
                        sent === i && "bg-emerald-600 hover:bg-emerald-600"
                      )}
                      variant={opt.type === "weak" ? "outline" : "default"}
                    >
                      {sending === i ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : sent === i ? (
                        "✓ Envoyé"
                      ) : opt.text === null ? (
                        "🔇 Choisir le silence"
                      ) : (
                        <><Send className="h-3 w-3" />Envoyer</>
                      )}
                    </Button>
                    {opt.text !== null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(opt.text!, i)}
                        className="h-7 w-7 p-0 rounded-lg"
                        title="Copier"
                      >
                        {copied === i ? <span className="text-emerald-600 text-xs">✓</span> : <Copy className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {sendError && <p className="text-xs text-destructive text-center">{sendError}</p>}
        </div>
      )}
    </div>
  );
}
