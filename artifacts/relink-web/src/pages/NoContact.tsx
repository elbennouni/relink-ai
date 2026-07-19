import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "wouter";
import { ShieldOff, RotateCcw, Zap, Heart, Trophy, Flame, CheckCircle2, Loader2, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useGetRelation } from "@workspace/api-client-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Session = {
  id: number;
  relationId: number;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
};

type Stats = {
  totalSessions: number;
  bestSeconds: number;
  urgesResisted: number;
  panics: number;
  resets: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return { d, h, m, s };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseSSELine(line: string) {
  if (!line.startsWith("data: ")) return {};
  try { return JSON.parse(line.slice(6)); } catch { return {}; }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NoContact() {
  const params = useParams();
  const relationId = Number(params.id);
  const { toast } = useToast();
  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });

  const [session, setSession] = useState<Session | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0); // seconds

  // UI state
  const [mode, setMode] = useState<"idle" | "confirm-reset" | "panic">("idle");
  const [panicText, setPanicText] = useState("");
  const [isPanicking, setIsPanicking] = useState(false);
  const [urgeLogged, setUrgeLogged] = useState(false);
  const panicScrollRef = useRef<HTMLDivElement>(null);

  // ── Fetch session & stats ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/relations/${relationId}/no-contact`);
      const data = await res.json();
      setSession(data.active);
      setStats(data.stats);
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger le module.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [relationId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Live counter ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.isActive) return;
    const update = () => {
      const s = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
      setElapsed(Math.max(0, s));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [session]);

  // ── Start no contact ───────────────────────────────────────────────────────
  const handleStart = async () => {
    try {
      const res = await fetch(`/api/relations/${relationId}/no-contact/start`, { method: "POST" });
      const data = await res.json();
      setSession(data);
      setStats((prev) => prev ? { ...prev, totalSessions: prev.totalSessions + 1 } : prev);
    } catch {
      toast({ title: "Erreur", description: "Impossible de démarrer.", variant: "destructive" });
    }
  };

  // ── Log urge ───────────────────────────────────────────────────────────────
  const handleUrge = async () => {
    try {
      await fetch(`/api/relations/${relationId}/no-contact/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "urge" }),
      });
      setStats((prev) => prev ? { ...prev, urgesResisted: prev.urgesResisted + 1 } : prev);
      setUrgeLogged(true);
      setTimeout(() => setUrgeLogged(false), 3000);
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = async () => {
    try {
      const res = await fetch(`/api/relations/${relationId}/no-contact/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Reset manuel" }),
      });
      const data = await res.json();
      setSession(data);
      setMode("idle");
      setStats((prev) => prev ? { ...prev, resets: prev.resets + 1, totalSessions: prev.totalSessions + 1 } : prev);
      toast({ title: "Compteur remis à zéro", description: "Chaque jour est une nouvelle chance." });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  // ── Panic support (SSE) ────────────────────────────────────────────────────
  const handlePanic = async () => {
    setMode("panic");
    setPanicText("");
    setIsPanicking(true);
    try {
      const res = await fetch(`/api/relations/${relationId}/no-contact/panic-support`, { method: "POST" });
      if (!res.ok || !res.body) throw new Error();
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
            if (parsed.content) {
              setPanicText((p) => p + parsed.content);
              setTimeout(() => {
                if (panicScrollRef.current)
                  panicScrollRef.current.scrollTop = panicScrollRef.current.scrollHeight;
              }, 0);
            }
          }
        }
      }
    } catch {
      setPanicText("Je suis là. Respire. Tu as tenu jusqu'ici — tu peux tenir encore.");
    } finally {
      setIsPanicking(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { d, h, m, s } = formatDuration(elapsed);
  const other = relation?.participantOther ?? "…";
  const bestDays = stats ? Math.floor(stats.bestSeconds / 86400) : 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-background">
      <div className="max-w-lg mx-auto w-full px-4 py-10 space-y-8">

        {/* ── Header ── */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            <ShieldOff className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest">No Contact</span>
          </div>
          <h1 className="text-2xl font-serif font-medium">
            {session?.isActive
              ? "Tu tiens bon."
              : "Prêt à reprendre le contrôle ?"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {session?.isActive
              ? `Sans contact avec ${other}`
              : `Commence ton No Contact avec ${other}`}
          </p>
        </div>

        {/* ── Counter ── */}
        {session?.isActive ? (
          <div className="bg-card border rounded-3xl p-8 text-center shadow-sm space-y-2">
            <div className="flex items-end justify-center gap-3">
              <CounterUnit value={d} label="jours" big />
              <span className="text-3xl font-light text-muted-foreground mb-4">:</span>
              <CounterUnit value={h} label="heures" />
              <span className="text-3xl font-light text-muted-foreground mb-4">:</span>
              <CounterUnit value={m} label="min" />
              <span className="text-3xl font-light text-muted-foreground mb-4">:</span>
              <CounterUnit value={s} label="sec" />
            </div>
            {bestDays > 0 && (
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Trophy className="h-3 w-3 text-amber-500" />
                Record : {bestDays} jour{bestDays > 1 ? "s" : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="bg-card border rounded-3xl p-8 text-center shadow-sm space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Flame className="h-7 w-7 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Chaque heure sans contact avec {other} est une victoire sur toi-même.
              Lance le compteur et laisse le temps travailler pour toi.
            </p>
            <Button onClick={handleStart} className="rounded-full px-8">
              Commencer maintenant
            </Button>
          </div>
        )}

        {/* ── Action buttons ── */}
        {session?.isActive && mode === "idle" && (
          <div className="grid grid-cols-1 gap-3">

            {/* Envie de répondre */}
            <button
              onClick={handleUrge}
              className={cn(
                "group relative flex items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-all",
                urgeLogged
                  ? "border-green-300 bg-green-50 text-green-800"
                  : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                urgeLogged ? "bg-green-200" : "bg-muted group-hover:bg-primary/10"
              )}>
                {urgeLogged
                  ? <CheckCircle2 className="h-5 w-5 text-green-700" />
                  : <Heart className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
                }
              </div>
              <div>
                <div className="font-medium text-sm">
                  {urgeLogged ? "Envie résistée 💪" : "Envie de répondre"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {urgeLogged
                    ? "Chaque envie résistée renforce ton pouvoir."
                    : "Je ressens l'envie mais je ne cède pas — je l'enregistre."}
                </div>
              </div>
              {!urgeLogged && stats && stats.urgesResisted > 0 && (
                <div className="ml-auto shrink-0 text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-1">
                  {stats.urgesResisted}
                </div>
              )}
            </button>

            {/* Panique */}
            <button
              onClick={handlePanic}
              className="group flex items-center gap-4 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 text-left transition-all hover:border-orange-400 hover:bg-orange-100"
            >
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 group-hover:bg-orange-200 transition-colors">
                <Zap className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <div className="font-medium text-sm text-orange-900">Mode panique</div>
                <div className="text-xs text-orange-700">Je suis sur le point de craquer — aide-moi à tenir.</div>
              </div>
            </button>

            {/* Reset */}
            <button
              onClick={() => setMode("confirm-reset")}
              className="group flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-left transition-all hover:border-destructive/30 hover:bg-destructive/5"
            >
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0 group-hover:bg-destructive/10 transition-colors">
                <RotateCcw className="h-5 w-5 text-muted-foreground group-hover:text-destructive" />
              </div>
              <div>
                <div className="font-medium text-sm text-muted-foreground group-hover:text-destructive">Réinitialiser</div>
                <div className="text-xs text-muted-foreground">J'ai craqué — je recommence depuis zéro.</div>
              </div>
            </button>
          </div>
        )}

        {/* ── Confirm reset ── */}
        {mode === "confirm-reset" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 space-y-4 animate-in slide-in-from-bottom-2">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Tu veux vraiment remettre à zéro ?</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {d > 0 ? `Tu as tenu ${d} jour${d > 1 ? "s" : ""}` : h > 0 ? `Tu as tenu ${h}h${pad(m)}` : "Tu commences à peine"} — ça compte.
                  Le compteur repart de zéro mais tes stats restent.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" className="rounded-full" onClick={handleReset}>
                Oui, recommencer
              </Button>
              <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setMode("idle")}>
                Non, je tiens
              </Button>
            </div>
          </div>
        )}

        {/* ── Panic support panel ── */}
        {mode === "panic" && (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 overflow-hidden animate-in slide-in-from-bottom-2 shadow-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-orange-200 bg-orange-100/60">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-600" />
                <span className="text-sm font-semibold text-orange-900">ReLink — Mode urgence</span>
                {isPanicking && <Loader2 className="h-3 w-3 animate-spin text-orange-600" />}
              </div>
              {!isPanicking && (
                <button onClick={() => setMode("idle")} className="text-orange-600 hover:text-orange-900">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div
              ref={panicScrollRef}
              className="px-5 py-4 max-h-64 overflow-y-auto text-[15px] leading-relaxed text-orange-950 whitespace-pre-wrap"
            >
              {panicText || <span className="text-orange-400 italic text-sm">ReLink arrive…</span>}
              {isPanicking && panicText && (
                <span className="inline-block w-[2px] h-4 bg-orange-500 ml-0.5 animate-pulse align-middle" />
              )}
            </div>
            {!isPanicking && panicText && (
              <div className="px-5 pb-4">
                <Button
                  size="sm"
                  className="rounded-full mt-2"
                  onClick={() => setMode("idle")}
                >
                  J'ai tenu 💪
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Stats ── */}
        {stats && (stats.urgesResisted > 0 || stats.resets > 0 || stats.totalSessions > 1) && (
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              value={stats.urgesResisted}
              label="Envies résistées"
              icon={<Heart className="h-4 w-4 text-rose-400" />}
            />
            <StatCard
              value={bestDays}
              label="Record (jours)"
              icon={<Trophy className="h-4 w-4 text-amber-500" />}
            />
            <StatCard
              value={stats.resets}
              label="Rechutes"
              icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
            />
          </div>
        )}

        {/* ── Motivation footer ── */}
        {session?.isActive && (
          <p className="text-center text-xs text-muted-foreground/60 leading-relaxed px-4">
            Chaque message non envoyé est une victoire sur le besoin de validation.
            La distance crée la valeur.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CounterUnit({ value, label, big }: { value: number; label: string; big?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={cn(
        "font-mono font-bold tabular-nums leading-none",
        big ? "text-6xl" : "text-4xl"
      )}>
        {big ? value : pad(value)}
      </span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

function StatCard({ value, label, icon }: { value: number; label: string; icon: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-2xl p-4 text-center space-y-1">
      <div className="flex justify-center">{icon}</div>
      <div className="text-2xl font-bold font-mono">{value}</div>
      <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
    </div>
  );
}
