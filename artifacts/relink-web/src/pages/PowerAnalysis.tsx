import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import JSZip from "jszip";
import { ArrowLeft, Upload, Zap, BarChart2, RefreshCw, FileText, Archive, Lock, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const api = (path: string) => `${BASE}${path}`;

interface ConvStats {
  meCount: number; otherCount: number;
  meChars: number; otherChars: number;
  meInitiates: number; otherInitiates: number;
  meAvgResponseMs: number; otherAvgResponseMs: number;
  meDoubleTexts: number; otherDoubleTexts: number;
  meQuestions: number; otherQuestions: number;
  totalMessages: number;
  dateFrom: string | null; dateTo: string | null;
}

interface StoredAnalysis {
  id: number;
  createdAt: string;
  powerScoreMe: number;
  powerScoreOther: number;
  analysisText: string;
  stats: ConvStats;
  messageCount: number;
  dateRangeFrom: string | null;
  dateRangeTo: string | null;
}

function formatMs(ms: number): string {
  if (!ms) return "–";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}j`;
}

function PowerBar({ scoreMe, scoreOther, nameMe, nameOther }: {
  scoreMe: number; scoreOther: number; nameMe: string; nameOther: string;
}) {
  const meColor = scoreMe < 40 ? "#ef4444" : scoreMe < 55 ? "#f59e0b" : "#22c55e";
  const otherColor = scoreOther < 40 ? "#ef4444" : scoreOther < 55 ? "#f59e0b" : "#22c55e";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium w-24 text-right truncate">{nameMe}</span>
        <div className="flex-1 h-8 bg-muted rounded-full overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 flex items-center justify-end pr-3"
            style={{ width: `${scoreMe}%`, backgroundColor: meColor }}
          >
            <span className="text-white text-xs font-bold">{scoreMe}</span>
          </div>
        </div>
        <span className="text-xs text-muted-foreground w-8">/100</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium w-24 text-right truncate">{nameOther}</span>
        <div className="flex-1 h-8 bg-muted rounded-full overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 flex items-center justify-end pr-3"
            style={{ width: `${scoreOther}%`, backgroundColor: otherColor }}
          >
            <span className="text-white text-xs font-bold">{scoreOther}</span>
          </div>
        </div>
        <span className="text-xs text-muted-foreground w-8">/100</span>
      </div>
      <p className="text-xs text-center text-muted-foreground">Score de pouvoir (100 = contrôle total)</p>
    </div>
  );
}

function StatRow({ label, me, other }: { label: string; me: string | number; other: string | number }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="flex-1 text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium w-20 text-center">{me}</span>
      <span className="text-xs font-medium w-20 text-center">{other}</span>
    </div>
  );
}

export default function PowerAnalysis() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { toast } = useToast();
  const isPremium = !!(user?.publicMetadata as Record<string, unknown>)?.isPremium;

  const [relation, setRelation] = useState<{ participantMe: string; participantOther: string } | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [existingAnalysis, setExistingAnalysis] = useState<StoredAnalysis | null>(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; total: number; dateRange?: { from: string | null; to: string | null } } | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [liveStats, setLiveStats] = useState<ConvStats | null>(null);
  const [finalScores, setFinalScores] = useState<{ me: number; other: number } | null>(null);

  const [showAnalysis, setShowAnalysis] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    fetch(api(`/api/relations/${id}`), { credentials: "include" })
      .then(r => r.json())
      .then(d => setRelation({ participantMe: d.participantMe || "Toi", participantOther: d.participantOther || "L'autre" }))
      .catch(() => {});

    fetch(api(`/api/relations/${id}/power-analysis`), { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setMessageCount(d.messageCount ?? 0);
        if (d.analysis) {
          setExistingAnalysis(d.analysis);
          setFinalScores({ me: d.analysis.powerScoreMe, other: d.analysis.powerScoreOther });
        }
      })
      .catch(() => {});
  }, [id]);

  const me = relation?.participantMe || "Toi";
  const other = relation?.participantOther || "L'autre";

  // ── FILE IMPORT ──────────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    if (!file) return;
    setImporting(true);
    try {
      let textContent = "";

      if (file.name.endsWith(".zip")) {
        const zip = await JSZip.loadAsync(file);
        // Find _chat.txt in the zip
        const chatFile = zip.file(/_chat\.txt$/i)?.[0] ?? Object.values(zip.files).find(f => f.name.endsWith(".txt") && !f.dir);
        if (!chatFile) {
          toast({ title: "Fichier introuvable", description: "Le fichier ZIP ne contient pas de _chat.txt", variant: "destructive" });
          setImporting(false);
          return;
        }
        textContent = await chatFile.async("string");
      } else if (file.name.endsWith(".txt")) {
        textContent = await file.text();
      } else {
        toast({ title: "Format non supporté", description: "Utilisez un fichier .txt ou .zip exporté depuis WhatsApp", variant: "destructive" });
        setImporting(false);
        return;
      }

      const resp = await fetch(api(`/api/relations/${id}/import/whatsapp`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: textContent }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        toast({ title: "Erreur import", description: data.error || "Impossible d'importer", variant: "destructive" });
        setImporting(false);
        return;
      }

      setImportResult({ imported: data.imported, total: data.totalMessages, dateRange: data.dateRange });
      setMessageCount(data.totalMessages);
      toast({
        title: `${data.imported} messages importés`,
        description: data.duplicates > 0 ? `(${data.duplicates} doublons ignorés)` : "Import réussi",
      });
    } catch (e) {
      toast({ title: "Erreur", description: "Impossible de lire le fichier", variant: "destructive" });
    }
    setImporting(false);
  }

  // ── ANALYSIS ─────────────────────────────────────────────────────────────────
  async function runAnalysis() {
    if (!id) return;
    setAnalyzing(true);
    setStreamedText("");
    setLiveStats(null);
    setFinalScores(null);
    setShowAnalysis(true);

    try {
      const resp = await fetch(api(`/api/relations/${id}/power-analysis`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!resp.body) throw new Error("No stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status) setStatus(data.message || data.status);
            if (data.stats) setLiveStats(data.stats);
            if (data.content) setStreamedText(p => p + data.content);
            if (data.done) {
              setFinalScores({ me: data.powerScoreMe, other: data.powerScoreOther });
              // Refresh stored analysis
              fetch(api(`/api/relations/${id}/power-analysis`), { credentials: "include" })
                .then(r => r.json())
                .then(d => { if (d.analysis) setExistingAnalysis(d.analysis); });
            }
            if (data.error) {
              toast({ title: "Erreur analyse", description: data.error, variant: "destructive" });
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      toast({ title: "Erreur", description: "L'analyse a échoué. Réessaie.", variant: "destructive" });
    }
    setAnalyzing(false);
    setStatus("");
  }

  const displayStats = liveStats ?? existingAnalysis?.stats ?? null;
  const displayText = streamedText || existingAnalysis?.analysisText || "";
  const displayScores = finalScores ?? (existingAnalysis ? { me: existingAnalysis.powerScoreMe, other: existingAnalysis.powerScoreOther } : null);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/relations/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-semibold text-sm">Rapport de force</h1>
          <p className="text-xs text-muted-foreground">{me} · {other}</p>
        </div>
        {existingAnalysis && (
          <Badge variant="outline" className="text-xs">
            Analysé {new Date(existingAnalysis.createdAt).toLocaleDateString("fr-FR")}
          </Badge>
        )}
      </div>

      <div className="flex-1 p-4 space-y-4 max-w-2xl mx-auto w-full">

        {/* Step 1 — Import */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Étape 1 — Importer la conversation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {messageCount > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-200">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-green-800 font-medium">{messageCount} messages déjà importés</span>
              </div>
            )}

            {importResult && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
                <Archive className="h-3 w-3" />
                {importResult.imported} nouveaux messages ajoutés
                {importResult.dateRange?.from && ` · du ${importResult.dateRange.from} au ${importResult.dateRange.to}`}
              </div>
            )}

            {/* How to export */}
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors flex items-center gap-1">
                <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
                Comment exporter depuis WhatsApp
              </summary>
              <div className="mt-2 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Sur iPhone / Android :</p>
                <p>1. Ouvre la conversation → <strong>⋮</strong> ou <strong>···</strong> → <em>Plus</em></p>
                <p>2. Exporter la discussion → <strong>Sans les médias</strong></p>
                <p>3. Envoie le fichier <code>.txt</code> ou <code>.zip</code> ici</p>
                <p className="mt-2 text-amber-700">📎 Sans les médias suffit pour l'analyse complète.</p>
              </div>
            </details>

            {/* Drop zone */}
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <input ref={fileRef} type="file" className="hidden" accept=".txt,.zip" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {importing ? (
                <div className="flex flex-col items-center gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Import en cours…</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">Dépose ton fichier ici</span>
                  <span className="text-xs text-muted-foreground">.txt ou .zip WhatsApp</span>
                </div>
              )}
            </div>

            {/* Media option (paid) */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
              <Lock className="h-4 w-4 text-amber-600 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium text-amber-900">Analyse des vocaux &amp; médias — 100€</p>
                <p className="text-xs text-amber-700">Transcription automatique des vocaux + analyse du ton et des émotions</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
                onClick={() => window.open("mailto:contact@relink.ai?subject=Analyse+médias", "_blank")}>
                Contacter
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Step 2 — Analyze */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Étape 2 — Analyser le rapport de force
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {messageCount < 20 && (
              <p className="text-xs text-muted-foreground">Il faut au moins 20 messages importés pour lancer l'analyse.</p>
            )}
            <Button
              className="w-full"
              disabled={analyzing || messageCount < 20}
              onClick={runAnalysis}
            >
              {analyzing ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />{status || "Analyse en cours…"}</>
              ) : (
                <><BarChart2 className="h-4 w-4 mr-2" />{existingAnalysis ? "Relancer l'analyse" : "Analyser maintenant"}</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        {(displayScores || analyzing) && (
          <>
            {/* Power scores */}
            {displayScores && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Score de pouvoir</CardTitle>
                </CardHeader>
                <CardContent>
                  <PowerBar scoreMe={displayScores.me} scoreOther={displayScores.other} nameMe={me} nameOther={other} />
                </CardContent>
              </Card>
            )}

            {/* Stats */}
            {displayStats && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Statistiques</span>
                    {displayStats.dateFrom && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {displayStats.dateFrom} → {displayStats.dateTo}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 pb-2 mb-1 border-b border-border/60">
                    <span className="flex-1 text-xs font-medium text-muted-foreground">Métrique</span>
                    <span className="text-xs font-semibold w-20 text-center">{me}</span>
                    <span className="text-xs font-semibold w-20 text-center">{other}</span>
                  </div>
                  <StatRow label="Messages envoyés" me={displayStats.meCount} other={displayStats.otherCount} />
                  <StatRow label="Caractères écrits" me={displayStats.meChars.toLocaleString("fr-FR")} other={displayStats.otherChars.toLocaleString("fr-FR")} />
                  <StatRow label="Conversations initiées" me={displayStats.meInitiates} other={displayStats.otherInitiates} />
                  <StatRow label="Temps de réponse moy." me={formatMs(displayStats.meAvgResponseMs)} other={formatMs(displayStats.otherAvgResponseMs)} />
                  <StatRow label="Double-textos" me={displayStats.meDoubleTexts} other={displayStats.otherDoubleTexts} />
                  <StatRow label="Questions posées" me={displayStats.meQuestions} other={displayStats.otherQuestions} />
                </CardContent>
              </Card>
            )}

            {/* Analysis text */}
            {(displayText || analyzing) && (
              <Card>
                <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowAnalysis(v => !v)}>
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Analyse complète</span>
                    {showAnalysis ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </CardTitle>
                </CardHeader>
                {showAnalysis && (
                  <CardContent>
                    {analyzing && !displayText && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        {status}
                      </div>
                    )}
                    {displayText && (
                      <div className="prose prose-sm max-w-none text-sm text-foreground prose-headings:text-foreground prose-headings:font-semibold prose-h2:text-base prose-h2:mt-4 prose-h2:mb-1 prose-p:leading-relaxed prose-li:leading-relaxed">
                        <ReactMarkdown>{displayText}</ReactMarkdown>
                        {analyzing && <span className="inline-block w-1 h-4 bg-primary animate-pulse ml-0.5" />}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            )}
          </>
        )}

        {/* Empty state */}
        {!displayScores && !analyzing && messageCount === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Importe d'abord la conversation</p>
            <p className="text-xs">Puis lance l'analyse pour voir le rapport de force</p>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
