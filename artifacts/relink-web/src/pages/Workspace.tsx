import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  useGetRelation,
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
  ChevronUp,
  RefreshCw,
  UploadCloud,
  CheckCircle2,
  BrainCircuit,
  ImagePlus,
  Smartphone,
  ZoomIn,
  Mic,
  Square,
  Wand2,
  Clock,
  ShieldAlert,
  Download,
  Copy,
} from "lucide-react";
import { SuggestRepliesDialog } from "@/components/SuggestRepliesDialog";
import { ScheduleTimerPopover } from "@/components/ScheduleTimerPopover";
import { StrategyPanel, type StrategyResult } from "@/components/StrategyPanel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ───────────────────────────────────────────────────────────────────

type PendingImage = {
  id: string;
  data: string;       // base64 sans le préfixe data:...
  mediaType: string;  // image/jpeg | image/png | ...
  previewUrl: string; // URL.createObjectURL
};

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: PendingImage[];
  isStreaming?: boolean;
};

type WaMessage = {
  id: number;
  relationId: number;
  sender: string;
  content: string;
  isMe: boolean;
  sentAt: string;
  importSource?: string;
  mediaData?: string | null; // base64 data URL pour les images
};

type MonthEntry = { year: number; month: number; count: number };

// ─── SSE parser ──────────────────────────────────────────────────────────────

function parseSSELine(line: string): {
  content?: string;
  done?: boolean;
  error?: string;
  contextUsed?: string[];
} {
  if (!line.startsWith("data: ")) return {};
  try {
    return JSON.parse(line.slice(6));
  } catch {
    return {};
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

const QUICK_CHIPS = [
  "Schémas répétitifs ?",
  "Ai-je été trop agressif ?",
  "Comment poser mes limites ?",
  "Que veut dire ce message ?",
  "Propose une réponse",
];

export default function Workspace() {
  const params = useParams();
  const relationId = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [activeMessageId, setActiveMessageId] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "agent">("chat");

  // ── Agent chat state ───────────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [contextLabel, setContextLabel] = useState("Contexte actif");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedConversation, setPastedConversation] = useState("");
  const [introTriggered, setIntroTriggered] = useState(false);

  const agentScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Measures the input area to set dynamic bottom padding on the agent scroll area
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const [inputAreaHeight, setInputAreaHeight] = useState(160);

  // ── WhatsApp messages state (infinite scroll) ──────────────────────────────
  const [waMessages, setWaMessages] = useState<WaMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalMessages, setTotalMessages] = useState(0);
  const [waLoading, setWaLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const waScrollRef = useRef<HTMLDivElement>(null);

  // ── Month sidebar state ────────────────────────────────────────────────────
  const [months, setMonths] = useState<MonthEntry[]>([]);
  const [activeMonth, setActiveMonth] = useState<string | null>(null); // "YYYY-M"
  const [monthLoading, setMonthLoading] = useState<string | null>(null);

  // ── Upload state (WhatsApp .txt) ───────────────────────────────────────────
  type UploadPhase = "idle" | "importing" | "building" | "done";
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadSteps, setUploadSteps] = useState<string[]>([]);
  const [uploadImported, setUploadImported] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Lightbox pour les images ───────────────────────────────────────────────
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // ── Générateur de réponses ─────────────────────────────────────────────────
  const [suggestOpen, setSuggestOpen] = useState(false);

  // ── WA direct input bar ────────────────────────────────────────────────────
  const [waDirectInput, setWaDirectInput] = useState("");
  const [waSendingDirect, setWaSendingDirect] = useState(false);
  const [scheduledPending, setScheduledPending] = useState<Array<{ id: number; content: string; scheduledAt: string }>>([]);

  // ── Analyse stratégique message entrant ────────────────────────────────────
  const [strategyResult, setStrategyResult] = useState<StrategyResult | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const lastAnalyzedMsgId = useRef<number | null>(null);

  // ── Enregistrement vocal ───────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, `recording.${mimeType.includes("mp4") ? "mp4" : "webm"}`);
          const res = await fetch("/api/transcribe", { method: "POST", body: form }); // /api prefix ajouté par le proxy
          const data = await res.json();
          if (data.text) setChatInput((prev) => (prev ? prev + " " + data.text : data.text));
        } catch { /* silently fail */ }
        finally { setIsTranscribing(false); }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      toast({ title: "Micro inaccessible", description: "Autorisez le micro dans votre navigateur.", variant: "destructive" });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, []);

  // ── SOS mode ───────────────────────────────────────────────────────────────
  const [sosActive, setSosActive] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);

  useEffect(() => {
    if (!relationId) return;
    fetch(`/api/relations/${relationId}/sos/status`)
      .then((r) => r.json())
      .then((d) => setSosActive(d.active ?? false))
      .catch(() => {});
  }, [relationId]);

  const toggleSos = useCallback(async () => {
    if (sosLoading) return;
    setSosLoading(true);
    try {
      const endpoint = sosActive ? "disable" : "enable";
      const r = await fetch(`/api/relations/${relationId}/sos/${endpoint}`, { method: "POST" });
      const d = await r.json();
      setSosActive(d.active ?? !sosActive);
      toast({
        title: d.active ? "🔴 Mode SOS activé" : "Mode SOS désactivé",
        description: d.active
          ? "L'IA répond à ta place, froide et détachée. Tu reprends le contrôle."
          : "Tu reprends les commandes.",
      });
    } catch { /* ignore */ }
    finally { setSosLoading(false); }
  }, [sosActive, sosLoading, relationId, toast]);

  // ── WhatsApp live status (declared here so callbacks below can use it) ───────
  const [waLiveStatus, setWaLiveStatus] = useState<"none" | "connected" | "connecting" | "disconnected">("none");
  const [waContactPhone, setWaContactPhone] = useState<string | undefined>(undefined);

  // ── Auto-refresh visuel ────────────────────────────────────────────────────
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);

  useEffect(() => {
    if (!relationId) return;
    let cancelled = false;
    const check = () => {
      fetch(`/api/relations/${relationId}/whatsapp/status`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) {
            setWaLiveStatus(d.status ?? "none");
            if (d.contactPhone) setWaContactPhone(d.contactPhone);
          }
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [relationId]);

  // ── Image attachments state ────────────────────────────────────────────────
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    Array.from(files).forEach((file) => {
      if (!allowed.includes(file.type)) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result = "data:<mediaType>;base64,<data>"
        const base64 = result.split(",")[1];
        setPendingImages((prev) => [
          ...prev,
          {
            id: `img-${Date.now()}-${Math.random()}`,
            data: base64,
            mediaType: file.type,
            previewUrl: URL.createObjectURL(file),
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // ── API data ───────────────────────────────────────────────────────────────
  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const { data: sessions } = useListAgentSessions(relationId, { query: { enabled: !!relationId } });
  const activeSessionId = sessions?.[0]?.id;
  const { data: sessionData } = useGetAgentSession(
    relationId,
    activeSessionId!,
    { query: { enabled: !!relationId && !!activeSessionId } }
  );
  const createSession = useCreateAgentSession();

  // ── Create session if none ─────────────────────────────────────────────────
  useEffect(() => {
    if (sessions && sessions.length === 0 && !createSession.isPending) {
      createSession.mutate({ relationId, data: { title: "Nouvelle analyse" } });
    }
  }, [sessions]);

  // ── Load initial WhatsApp messages ─────────────────────────────────────────
  const loadInitial = useCallback(() => {
    if (!relationId) return;
    setWaLoading(true);
    // Ne pas effacer les messages pendant le rechargement pour éviter le flash
    fetch(`/api/relations/${relationId}/messages?limit=60`)
      .then((r) => r.json())
      .then((data) => {
        setWaMessages(data.messages ?? []);
        setNextCursor(data.nextCursor ?? null);
        setTotalMessages(data.total ?? 0);
        // Scroll vers le bas pour afficher les messages les plus récents
        setTimeout(() => {
          waScrollRef.current?.scrollTo({ top: waScrollRef.current.scrollHeight });
        }, 80);
      })
      .catch(() => {})
      .finally(() => setWaLoading(false));
  }, [relationId]);

  useEffect(() => {
    // Vider les messages immédiatement quand on change de relation
    setWaMessages([]);
    setNextCursor(null);
    loadInitial();
  }, [relationId]);

  // ── WA direct input bar — scheduled messages ───────────────────────────────
  const loadScheduled = useCallback(() => {
    if (!relationId) return;
    fetch(`/api/relations/${relationId}/messages/scheduled`)
      .then((r) => r.json())
      .then((d) => setScheduledPending(d.scheduled ?? []))
      .catch(() => {});
  }, [relationId]);

  useEffect(() => { loadScheduled(); }, [loadScheduled]);

  const handleWaDirectSend = useCallback(async (text: string, delayMinutes: number) => {
    const trimmed = text.trim();
    if (!trimmed || waSendingDirect) return;
    setWaSendingDirect(true);
    setWaDirectInput("");
    try {
      if (delayMinutes > 0) {
        await fetch(`/api/relations/${relationId}/messages/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed, delayMinutes }),
        });
        const label = delayMinutes === 30 ? "30 min" : delayMinutes === 120 ? "2h" : "5h";
        toast({ title: "Message programmé", description: `Envoi dans ${label}` });
        loadScheduled();
      } else if (waLiveStatus === "connected") {
        await fetch(`/api/relations/${relationId}/whatsapp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        setTimeout(() => loadInitial(), 600);
      } else {
        await fetch(`/api/relations/${relationId}/messages/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed }),
        });
        setTimeout(() => loadInitial(), 600);
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible d'envoyer.", variant: "destructive" });
      setWaDirectInput(trimmed);
    } finally {
      setWaSendingDirect(false);
    }
  }, [waSendingDirect, relationId, waLiveStatus, toast, loadInitial, loadScheduled]);

  // ── Live refresh : nouveaux messages quand WhatsApp est connecté ───────────
  const newestSentAtRef = useRef<string | null>(null);

  // Garde newestSentAtRef synchronisé avec les messages affichés
  useEffect(() => {
    if (waMessages.length > 0) {
      const last = waMessages[waMessages.length - 1];
      newestSentAtRef.current = new Date(last.sentAt).toISOString();
    }
  }, [waMessages]);

  // Quand WhatsApp passe à "connected", recharge les messages une fois
  // (le polling incrémental de 5s prend ensuite le relais)
  const prevLiveStatus = useRef<string>("none");
  useEffect(() => {
    if (waLiveStatus === "connected" && prevLiveStatus.current !== "connected") {
      loadInitial();
      const t1 = setTimeout(() => loadInitial(), 8_000);
      prevLiveStatus.current = "connected";
      return () => { clearTimeout(t1); };
    }
    prevLiveStatus.current = waLiveStatus;
  }, [waLiveStatus]);

  useEffect(() => {
    if (waLiveStatus !== "connected") return;
    if (!relationId) return;

    const poll = () => {
      const after = newestSentAtRef.current;
      if (!after) { loadInitial(); return; }

      setIsAutoRefreshing(true);
      fetch(`/api/relations/${relationId}/messages?after=${encodeURIComponent(after)}&limit=200`)
        .then((r) => r.json())
        .then((data) => {
          const newMsgs: WaMessage[] = data.messages ?? [];
          setTotalMessages(data.total ?? 0);
          if (newMsgs.length === 0) return;
          setWaMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const toAdd = newMsgs.filter((m) => !existingIds.has(m.id));
            if (toAdd.length === 0) return prev;
            const el = waScrollRef.current;
            const wasAtBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : false;
            const next = [...prev, ...toAdd];
            if (!wasAtBottom) setNewMessageCount((c) => c + toAdd.length);
            if (wasAtBottom) setTimeout(() => el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" }), 50);
            return next;
          });
        })
        .catch(() => {})
        .finally(() => setTimeout(() => setIsAutoRefreshing(false), 600));
    };

    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, [waLiveStatus, relationId]);

  // ── Load months list ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!relationId) return;
    fetch(`/api/relations/${relationId}/messages/months`)
      .then((r) => r.json())
      .then((data) => setMonths(data.months ?? []))
      .catch(() => {});
  }, [relationId]);

  // ── Auto-build memory if missing ───────────────────────────────────────────
  useEffect(() => {
    if (!relationId) return;
    let cancelled = false;

    const checkAndBuild = async () => {
      try {
        const memCheck = await fetch(`/api/relations/${relationId}/memory`);
        if (!memCheck.ok) return;
        const memData = await memCheck.json();
        if (memData?.memory?.builtAt) return; // already built — nothing to do

        // No memory yet — trigger build automatically
        if (cancelled) return;
        setUploadPhase("building");
        setUploadSteps(["Lecture de la conversation…"]);
        setUploadImported(null);

        const STEP_LABELS: Record<string, string> = {
          reading:    "Lecture de la conversation…",
          detecting:  "Détection des messages…",
          encrypting: "Chiffrement sécurisé…",
          building:   "Analyse des dynamiques et construction de la mémoire…",
          saving:     "Enregistrement…",
          done:       "Analyse complète ✓",
        };

        const buildRes = await fetch(`/api/relations/${relationId}/memory/build`, { method: "POST" });
        if (!buildRes.ok || !buildRes.body || cancelled) return;

        const reader = buildRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.step) {
                  const label = STEP_LABELS[ev.step] ?? ev.label ?? ev.step;
                  setUploadSteps((p) => p[p.length - 1] === label ? p : [...p, label]);
                }
              } catch { /* ignore */ }
            }
          }
        }

        if (!cancelled) {
          setUploadPhase("done");
          setTimeout(() => setUploadPhase("idle"), 4000);
        }
      } catch {
        if (!cancelled) setUploadPhase("idle");
      }
    };

    checkAndBuild();
    return () => { cancelled = true; };
  }, [relationId]);

  // ── File upload handler ────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (file: File) => {
    if (!relationId) return;
    setUploadPhase("importing");
    setUploadSteps(["Lecture du fichier…"]);
    setUploadImported(null);

    try {
      const content = await file.text();

      // 1. Import
      const importRes = await fetch(`/api/relations/${relationId}/import/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, filename: file.name }),
      });
      if (!importRes.ok) throw new Error(`Import échoué (${importRes.status})`);
      const importData = await importRes.json();
      setUploadImported(importData.imported ?? 0);
      setUploadSteps((p) => [...p, `${(importData.imported ?? 0).toLocaleString("fr-FR")} messages importés ✓`]);

      // 2. Build memory (SSE)
      setUploadPhase("building");
      const STEP_LABELS: Record<string, string> = {
        reading:    "Lecture de la conversation…",
        detecting:  "Détection des messages…",
        encrypting: "Chiffrement sécurisé…",
        building:   "Analyse des dynamiques et construction de la mémoire…",
        saving:     "Enregistrement…",
        done:       "Analyse complète ✓",
      };

      const memRes = await fetch(`/api/relations/${relationId}/memory/build`, { method: "POST" });
      if (!memRes.ok || !memRes.body) throw new Error("Memory build échoué");

      const reader = memRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.step) {
                const label = STEP_LABELS[ev.step] ?? ev.label ?? ev.step;
                setUploadSteps((p) => p[p.length - 1] === label ? p : [...p, label]);
              }
            } catch { /* ignore */ }
          }
        }
      }

      // 3. Done — refresh everything
      setUploadPhase("done");
      loadInitial();
      // Reload months
      fetch(`/api/relations/${relationId}/messages/months`)
        .then((r) => r.json())
        .then((d) => setMonths(d.months ?? []))
        .catch(() => {});

      // Auto-dismiss after 3s
      setTimeout(() => setUploadPhase("idle"), 3000);

    } catch (err) {
      toast({
        title: "Erreur d'import",
        description: err instanceof Error ? err.message : "Une erreur est survenue.",
        variant: "destructive",
      });
      setUploadPhase("idle");
    }
  }, [relationId, loadInitial, toast]);

  // ── Load more (older) messages when sentinel becomes visible ───────────────
  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore || !relationId) return;

    const container = waScrollRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    setIsLoadingMore(true);
    try {
      const data = await fetch(
        `/api/relations/${relationId}/messages?cursor=${encodeURIComponent(nextCursor)}&limit=60`
      ).then((r) => r.json());

      setWaMessages((prev) => [...(data.messages ?? []), ...prev]);
      setNextCursor(data.nextCursor ?? null);

      // Restore scroll position so newly prepended messages don't jump the view
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    } catch {
      // silent
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore, relationId]);

  // ── IntersectionObserver for top sentinel ──────────────────────────────────
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !isLoadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, isLoadingMore]);

  // ── ResizeObserver — keep bottom padding in sync with input area ────────────
  useEffect(() => {
    const el = inputAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setInputAreaHeight(entries[0].contentRect.height + 24); // +24 gradient bleed
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Scroll agent to bottom when upload panel appears/expands ───────────────
  useEffect(() => {
    if (uploadPhase === "idle") return;
    // Small delay lets ResizeObserver update paddingBottom first
    const t = setTimeout(() => {
      const el = agentScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 80);
    return () => clearTimeout(t);
  }, [uploadPhase, uploadSteps.length]);

  // ── Auto-intro for empty sessions ──────────────────────────────────────────
  useEffect(() => {
    if (sessionData?.messages && localMessages.length === 0) {
      if (sessionData.messages.length > 0) {
        setLocalMessages(
          sessionData.messages.map((m) => ({
            id: String(m.id),
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
      } else if (!introTriggered) {
        triggerIntro(sessionData.id as number);
      }
    }
  }, [sessionData]);

  const triggerIntro = async (sessionId: number) => {
    setIntroTriggered(true);
    const assistantId = `intro-${Date.now()}`;
    setLocalMessages([{ id: assistantId, role: "assistant", content: "", isStreaming: true }]);
    setIsStreaming(true);
    try {
      const res = await fetch(
        `/api/relations/${relationId}/agent/sessions/${sessionId}/intro`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      );
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
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
            if (parsed.contextUsed?.length) setContextLabel(parsed.contextUsed.join(" · "));
            if (parsed.content) {
              setLocalMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + parsed.content } : m
                )
              );
            }
            if (parsed.done) {
              setLocalMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
              );
            }
          }
        }
      }
    } catch {
      setLocalMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Je suis prêt à analyser votre relation. Posez-moi une question.", isStreaming: false }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Auto-scroll agent chat on new content ──────────────────────────────────
  useEffect(() => {
    if (agentScrollRef.current) {
      agentScrollRef.current.scrollTop = agentScrollRef.current.scrollHeight;
    }
  }, [localMessages]);

  // ── Send month to agent ────────────────────────────────────────────────────
  const sendMonthToAgent = useCallback(
    async (year: number, month: number) => {
      if (isStreaming || !activeSessionId) return;
      const key = `${year}-${month}`;
      setMonthLoading(key);
      setActiveMonth(key);

      try {
        const data = await fetch(
          `/api/relations/${relationId}/messages?year=${year}&month=${month}&limit=1000`
        ).then((r) => r.json());

        const msgs: WaMessage[] = data.messages ?? [];
        if (!msgs.length) {
          toast({ title: "Mois vide", description: "Aucun message ce mois.", variant: "destructive" });
          setMonthLoading(null);
          return;
        }

        // Format as readable transcript
        const formatted = msgs
          .map((m) => {
            const time = format(new Date(m.sentAt), "dd/MM HH:mm");
            return `[${time}] ${m.sender}: ${m.content}`;
          })
          .join("\n");

        const monthName = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: fr });
        const prompt = `Analyse les échanges de ${monthName} (${msgs.length} messages). Quels schémas, tensions et moments clés ressortent ce mois-là ?`;

        // Inject directly without touching paste state
        await sendMessageDirect(prompt, formatted);
      } catch {
        toast({ title: "Erreur", description: "Impossible de charger ce mois.", variant: "destructive" });
      } finally {
        setMonthLoading(null);
      }
    },
    [isStreaming, activeSessionId, relationId, toast]
  );

  // ── Send recent window to agent (2h / 24h / 48h) ──────────────────────────
  const sendRecentToAgent = useCallback(
    async (label: string, hours: number) => {
      if (isStreaming || !activeSessionId) return;
      const key = `recent-${hours}h`;
      setMonthLoading(key);
      setActiveMonth(key);

      try {
        const now = new Date();
        const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);

        // Collect the month(s) we need to cover (handles spanning a month boundary)
        const monthKeys = new Set<string>();
        monthKeys.add(`${now.getFullYear()}-${now.getMonth() + 1}`);
        if (
          cutoff.getMonth() !== now.getMonth() ||
          cutoff.getFullYear() !== now.getFullYear()
        ) {
          monthKeys.add(`${cutoff.getFullYear()}-${cutoff.getMonth() + 1}`);
        }

        let allMsgs: WaMessage[] = [];
        for (const ym of monthKeys) {
          const [y, mo] = ym.split("-").map(Number);
          const data = await fetch(
            `/api/relations/${relationId}/messages?year=${y}&month=${mo}&limit=2000`
          ).then((r) => r.json());
          allMsgs = [...allMsgs, ...(data.messages ?? [])];
        }

        const msgs = allMsgs
          .filter((m) => new Date(m.sentAt) >= cutoff)
          .sort(
            (a, b) =>
              new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
          );

        if (!msgs.length) {
          toast({
            title: "Aucun message récent",
            description: `Aucun échange dans les ${label}.`,
            variant: "destructive",
          });
          setMonthLoading(null);
          return;
        }

        const formatted = msgs
          .map((m) => {
            const time = format(new Date(m.sentAt), "dd/MM HH:mm");
            return `[${time}] ${m.sender}: ${m.content}`;
          })
          .join("\n");

        const fromStr = format(cutoff, "dd/MM à HH:mm", { locale: fr });
        const prompt = `Analyse les ${msgs.length} messages des ${label} (depuis ${fromStr}). Quelles tensions, dynamiques et moments clés ressortent sur cette période ?`;

        await sendMessageDirect(prompt, formatted);
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de charger les messages récents.",
          variant: "destructive",
        });
      } finally {
        setMonthLoading(null);
      }
    },
    [isStreaming, activeSessionId, relationId, toast]
  );

  // ── Send message (direct, bypasses paste state) ────────────────────────────
  const sendMessageDirect = useCallback(
    async (text: string, injectedContext?: string) => {
      const trimmed = text.trim();
      if (!trimmed || !activeSessionId) return;

      const userId = `u-${Date.now()}`;
      const assistantId = `a-${Date.now()}`;

      const displayContent = injectedContext
        ? `${trimmed}\n\n[${injectedContext.split("\n").length} messages chargés]`
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
              pastedConversation: injectedContext || undefined,
            }),
          }
        );
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
              if (parsed.contextUsed?.length) setContextLabel(parsed.contextUsed.join(" · "));
              if (parsed.content) {
                setLocalMessages((prev) =>
                  prev.map((m) => m.id === assistantId ? { ...m, content: m.content + parsed.content } : m)
                );
              }
              if (parsed.done) {
                setLocalMessages((prev) =>
                  prev.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m)
                );
              }
              if (parsed.error) {
                setLocalMessages((prev) =>
                  prev.map((m) => m.id === assistantId ? { ...m, content: parsed.error!, isStreaming: false } : m)
                );
              }
            }
          }
        }
      } catch {
        toast({ title: "Erreur de connexion", description: "Impossible de joindre l'agent.", variant: "destructive" });
        setLocalMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: "Une erreur est survenue.", isStreaming: false } : m)
        );
      } finally {
        setIsStreaming(false);
        setActiveMessageId(null);
      }
    },
    [activeSessionId, relationId, toast]
  );

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if ((!trimmed && pendingImages.length === 0) || isStreaming || !activeSessionId) return;

      setChatInput("");
      const pasteCopy = pastedConversation.trim();
      if (pasteCopy) {
        setPastedConversation("");
        setPasteOpen(false);
      }

      // Capture & clear images
      const imagesCopy = [...pendingImages];
      setPendingImages([]);

      const userId = `u-${Date.now()}`;
      const assistantId = `a-${Date.now()}`;

      const displayContent = pasteCopy
        ? `${trimmed}\n\n[Conversation collée — ${pasteCopy.split("\n").length} lignes]`
        : trimmed || (imagesCopy.length > 0 ? "Analyse cette image." : "");

      setLocalMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: displayContent, images: imagesCopy.length ? imagesCopy : undefined },
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);
      setIsStreaming(true);

      const messageToSend = trimmed || "Analyse cette image et dis-moi ce que tu en penses dans le contexte de notre relation.";

      try {
        const res = await fetch(
          `/api/relations/${relationId}/agent/sessions/${activeSessionId}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: messageToSend,
              selectedMessageIds: activeMessageId ? [activeMessageId] : undefined,
              pastedConversation: pasteCopy || undefined,
              images: imagesCopy.length
                ? imagesCopy.map((img) => ({ data: img.data, mediaType: img.mediaType }))
                : undefined,
            }),
          }
        );
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
              if (parsed.contextUsed?.length) setContextLabel(parsed.contextUsed.join(" · "));
              if (parsed.content) {
                setLocalMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + parsed.content } : m
                  )
                );
              }
              if (parsed.done) {
                setLocalMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
                );
              }
              if (parsed.error) {
                setLocalMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: parsed.error!, isStreaming: false } : m
                  )
                );
              }
            }
          }
        }
      } catch {
        toast({
          title: "Erreur de connexion",
          description: "Impossible de joindre l'agent.",
          variant: "destructive",
        });
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
    },
    [isStreaming, activeSessionId, relationId, activeMessageId, pastedConversation, pendingImages, toast]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput);
    }
  };

  if (!relation)
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full bg-background overflow-hidden relative">

      {/* ── Dialog suggestions de réponses ────────────────────────────────── */}
      <SuggestRepliesDialog
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        relationId={relationId}
        contactName={relation?.participantOther ?? "Contact"}
        contactPhone={waContactPhone}
        waConnected={waLiveStatus === "connected"}
        onPasteToAgent={(text) => setChatInput(text)}
      />

      {/* ── Lightbox ───────────────────────────────────────────────────────── */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white p-2"
            onClick={() => setLightboxSrc(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxSrc}
            alt="Image WhatsApp"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {/* Mobile Tabs */}
      <div className="md:hidden absolute top-0 left-0 right-0 z-10 bg-background/80 backdrop-blur-md border-b flex px-4">
        <button
          onClick={() => setMobileTab("chat")}
          className={cn(
            "flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
            mobileTab === "chat"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          )}
        >
          Conversation
        </button>
        <button
          onClick={() => setMobileTab("agent")}
          className={cn(
            "flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
            mobileTab === "agent"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          )}
        >
          Agent ReLink
        </button>
      </div>

      {/* ── Left — WhatsApp viewer ─────────────────────────────────────────── */}
      <div
        className={cn(
          "flex-1 md:flex-[1.2] lg:flex-1 flex-col border-r bg-card/30 h-full",
          mobileTab === "chat" ? "flex" : "hidden md:flex"
        )}
      >
        {/* Header */}
        <div className="h-16 mt-10 md:mt-0 px-4 flex items-center justify-between border-b bg-background/50 backdrop-blur-sm sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-medium text-muted-foreground">
              {relation.participantOther.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-medium flex items-center gap-2">
                {relation.participantOther}
                {waLiveStatus === "connected" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 rounded-full px-2 py-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                    WhatsApp en direct
                  </span>
                )}
                {waLiveStatus === "connecting" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Connexion…
                  </span>
                )}
              </div>
              {waLiveStatus === "connected" && totalMessages > 0 && (
                <div className="text-xs text-muted-foreground">
                  {waMessages.length} / {totalMessages.toLocaleString("fr-FR")} messages
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Badge nouveaux messages */}
            {newMessageCount > 0 && (
              <button
                onClick={() => {
                  setNewMessageCount(0);
                  waScrollRef.current?.scrollTo({ top: waScrollRef.current.scrollHeight, behavior: "smooth" });
                }}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1 hover:bg-primary/20 transition-colors"
              >
                ↓ {newMessageCount} nouveau{newMessageCount > 1 ? "x" : ""}
              </button>
            )}
            <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground">
              <Search className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-muted-foreground"
              title="Mettre à jour la conversation"
              onClick={() => { loadInitial(); setNewMessageCount(0); }}
              disabled={waLoading}
            >
              <RefreshCw className={cn("h-4 w-4", (waLoading || isAutoRefreshing) && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "rounded-full",
                strategyLoading
                  ? "text-primary animate-pulse"
                  : strategyResult
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-primary"
              )}
              title="Analyser le dernier message reçu"
              onClick={() => {
                setStrategyResult(null);
                setStrategyLoading(true);
                fetch(`/api/relations/${relationId}/analyze-incoming`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                })
                  .then((r) => r.json())
                  .then((d) => setStrategyResult(d))
                  .catch(() => setStrategyResult(null))
                  .finally(() => setStrategyLoading(false));
              }}
              disabled={strategyLoading}
            >
              {strategyLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <BrainCircuit className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-violet-500 hover:bg-violet-50 hover:text-violet-600"
              title="Générer une réponse WhatsApp"
              onClick={() => setSuggestOpen(true)}
            >
              <Wand2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "rounded-full transition-all",
                sosActive
                  ? "bg-red-500 text-white hover:bg-red-600 animate-pulse shadow-lg shadow-red-200"
                  : "text-muted-foreground hover:bg-red-50 hover:text-red-500"
              )}
              title={sosActive ? "Mode SOS actif — clic pour désactiver" : "Activer le Mode SOS"}
              onClick={toggleSos}
              disabled={sosLoading}
            >
              {sosLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ShieldAlert className="h-4 w-4" />}
            </Button>
            {/* Copier toute la conversation */}
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-muted-foreground"
              title="Copier la conversation (texte)"
              onClick={() => {
                const text = waMessages.map((msg) => {
                  const time = format(new Date(msg.sentAt), "dd/MM HH:mm");
                  const sender = msg.isMe ? "Moi" : msg.sender;
                  const isAud = !!msg.mediaData && msg.mediaData.startsWith("data:audio");
                  const isImg = !!msg.mediaData && msg.mediaData.startsWith("data:image");
                  const body = isAud
                    ? `[Vocal]${msg.content && msg.content !== "[Message vocal]" ? " " + msg.content.replace(/^\[Vocal\] /, "") : ""}`
                    : isImg
                    ? `[Image]${msg.content && msg.content !== "[Image]" ? " " + msg.content : ""}`
                    : msg.content;
                  return `[${time}] ${sender}: ${body}`;
                }).join("\n");
                navigator.clipboard.writeText(text).then(() =>
                  toast({ title: "Conversation copiée", description: `${waMessages.length} messages dans le presse-papiers` })
                );
              }}
              disabled={waMessages.length === 0}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {/* Télécharger tous les messages vocaux */}
            {waMessages.some((m) => m.mediaData?.startsWith("data:audio")) && (
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full text-muted-foreground"
                title="Télécharger tous les audios"
                onClick={() => {
                  const audios = waMessages.filter((m) => m.mediaData?.startsWith("data:audio"));
                  audios.forEach((msg, i) => {
                    setTimeout(() => {
                      const a = document.createElement("a");
                      a.href = msg.mediaData!;
                      const ext = msg.mediaData!.includes("ogg") ? "ogg" : msg.mediaData!.includes("mp4") ? "m4a" : "opus";
                      a.download = `vocal-${format(new Date(msg.sentAt), "yyyy-MM-dd_HH-mm")}-${i + 1}.${ext}`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }, i * 400);
                  });
                  toast({ title: `${audios.length} audio${audios.length > 1 ? "s" : ""} en téléchargement` });
                }}
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* SOS mode banner */}
        {sosActive && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white text-xs font-medium">
            <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
            Mode SOS actif — L'IA prépare une réponse calme à ta place
            <button onClick={toggleSos} className="ml-auto underline hover:no-underline">
              Désactiver
            </button>
          </div>
        )}

        {/* Body — month strip + messages */}
        <div className="flex flex-1 min-h-0">

          {/* Month strip */}
          {months.length > 0 && (
            <div className="hidden md:flex flex-col w-14 border-r bg-background/60 overflow-y-auto shrink-0">
              <div className="py-2 px-1 space-y-0.5">

                {/* ── Quick recent-window buttons ── */}
                {(
                  [
                    { key: "recent-2h",  label: "2h",  hours: 2,  title: "2 dernières heures" },
                    { key: "recent-24h", label: "24h", hours: 24, title: "Dernière journée" },
                    { key: "recent-48h", label: "48h", hours: 48, title: "2 derniers jours" },
                  ] as const
                ).map(({ key, label, hours, title }) => {
                  const isActive   = activeMonth === key;
                  const isSpinning = monthLoading === key;
                  return (
                    <button
                      key={key}
                      onClick={() => sendRecentToAgent(title, hours)}
                      disabled={isStreaming || !!monthLoading}
                      title={`Analyser : ${title}`}
                      className={cn(
                        "w-full flex flex-col items-center py-2 px-1 rounded-lg text-center transition-all",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        (isStreaming || !!monthLoading) && !isSpinning && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      {isSpinning ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Clock className="h-3 w-3 mb-0.5" />
                      )}
                      <span className="text-[10px] font-semibold leading-none">{label}</span>
                    </button>
                  );
                })}

                {/* divider */}
                <div className="border-t border-border/40 my-1" />

                {months.map((m) => {
                  const key = `${m.year}-${m.month}`;
                  const isActive = activeMonth === key;
                  const isSpinning = monthLoading === key;
                  const label = format(new Date(m.year, m.month - 1, 1), "MMM", { locale: fr });
                  const yearShort = String(m.year).slice(2);
                  return (
                    <button
                      key={key}
                      onClick={() => sendMonthToAgent(m.year, m.month)}
                      disabled={isStreaming || !!monthLoading}
                      title={`${format(new Date(m.year, m.month - 1, 1), "MMMM yyyy", { locale: fr })} — ${m.count.toLocaleString("fr-FR")} messages`}
                      className={cn(
                        "w-full flex flex-col items-center py-2 px-1 rounded-lg text-center transition-all group",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        (isStreaming || !!monthLoading) && !isSpinning && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      {isSpinning ? (
                        <Loader2 className="h-3 w-3 animate-spin mb-1" />
                      ) : (
                        <span className="text-[11px] font-semibold leading-none capitalize">{label}</span>
                      )}
                      <span className="text-[9px] leading-none mt-0.5 opacity-70">{yearShort}</span>
                      <span className={cn(
                        "text-[8px] leading-none mt-1 font-medium tabular-nums",
                        isActive ? "text-primary/70" : "text-muted-foreground/60 group-hover:text-muted-foreground"
                      )}>
                        {m.count > 999 ? `${Math.round(m.count / 1000)}k` : m.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Messages — scrollable, with infinite scroll at the top */}
          <div ref={waScrollRef} className="flex-1 overflow-y-auto min-h-0">
          <div className="space-y-4 max-w-2xl mx-auto pb-8 pt-4 px-4">
            {/* Top sentinel — triggers load of older messages */}
            <div ref={topSentinelRef} className="h-1" />

            {/* Loading more indicator */}
            {isLoadingMore && (
              <div className="flex justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Load-more button shown when cursor exists but sentinel might not trigger */}
            {nextCursor && !isLoadingMore && (
              <button
                onClick={loadMore}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronUp className="h-3 w-3" />
                Charger les messages précédents
              </button>
            )}

            {waLoading ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : waMessages.length === 0 ? (
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
              waMessages.map((msg, i) => {
                const showDate =
                  i === 0 ||
                  new Date(msg.sentAt).getDate() !== new Date(waMessages[i - 1].sentAt).getDate();
                const isSelected = activeMessageId === msg.id;

                const isImage = !!msg.mediaData && msg.mediaData.startsWith("data:image");
                const isAudio = !!msg.mediaData && msg.mediaData.startsWith("data:audio");

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
                          if (isImage) return; // image click gérée séparément
                          setActiveMessageId(isSelected ? null : msg.id);
                          if (!isSelected && window.innerWidth < 768) setMobileTab("agent");
                        }}
                        className={cn(
                          "relative max-w-[85%] md:max-w-[75%] rounded-2xl text-[15px] leading-relaxed cursor-pointer transition-all select-none overflow-hidden",
                          isImage ? "p-0" : "px-4 py-2.5",
                          msg.isMe
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-background border rounded-tl-sm",
                          isSelected && "ring-2 ring-amber-400 ring-offset-2 ring-offset-background"
                        )}
                      >
                        {!msg.isMe && !isImage && (
                          <div className="text-[11px] font-semibold text-amber-600 mb-1">
                            {msg.sender}
                          </div>
                        )}

                        {/* ── Image inline ── */}
                        {isImage && (
                          <div className="relative group">
                            {!msg.isMe && (
                              <div className="absolute top-2 left-2 z-10 text-[11px] font-semibold text-white bg-black/40 rounded px-1.5 py-0.5 backdrop-blur-sm">
                                {msg.sender}
                              </div>
                            )}
                            <img
                              src={msg.mediaData!}
                              alt="Image WhatsApp"
                              className="max-w-[240px] max-h-[300px] w-auto h-auto object-cover rounded-2xl block"
                              onClick={() => setLightboxSrc(msg.mediaData!)}
                            />
                            <button
                              onClick={() => setLightboxSrc(msg.mediaData!)}
                              className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors rounded-2xl"
                            >
                              <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                            </button>
                            {msg.content && msg.content !== "[Image]" && (
                              <div className={cn(
                                "px-3 pb-2 pt-1 text-[13px]",
                                msg.isMe ? "text-primary-foreground" : "text-foreground"
                              )}>
                                {msg.content}
                              </div>
                            )}
                            <div className={cn(
                              "text-[10px] px-3 pb-2 text-right",
                              msg.isMe ? "text-primary-foreground/60" : "text-muted-foreground"
                            )}>
                              {format(new Date(msg.sentAt), "HH:mm")}
                            </div>
                          </div>
                        )}

                        {/* ── Message vocal avec lecteur audio ── */}
                        {isAudio && (
                          <div className="space-y-2 py-0.5">
                            {!msg.isMe && (
                              <div className="text-[11px] font-semibold text-amber-600">{msg.sender}</div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <audio
                                controls
                                src={msg.mediaData!}
                                className="w-full max-w-[220px] h-9"
                                style={{ colorScheme: msg.isMe ? "dark" : "light" }}
                              />
                              <button
                                title="Télécharger cet audio"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const a = document.createElement("a");
                                  a.href = msg.mediaData!;
                                  const ext = msg.mediaData!.includes("ogg") ? "ogg" : msg.mediaData!.includes("mp4") ? "m4a" : "opus";
                                  a.download = `vocal-${format(new Date(msg.sentAt), "yyyy-MM-dd_HH-mm")}.${ext}`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                }}
                                className={cn(
                                  "shrink-0 rounded-full p-1 opacity-60 hover:opacity-100 transition-opacity",
                                  msg.isMe ? "text-primary-foreground" : "text-muted-foreground"
                                )}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {msg.content && msg.content !== "[Message vocal]" && (
                              <p className={cn(
                                "text-[13px] leading-relaxed italic border-l-2 pl-2",
                                msg.isMe
                                  ? "border-primary-foreground/30 text-primary-foreground/80"
                                  : "border-muted-foreground/30 text-muted-foreground"
                              )}>
                                {msg.content.replace(/^\[Vocal\] /, "")}
                              </p>
                            )}
                            <div className={cn(
                              "text-[10px] text-right",
                              msg.isMe ? "text-primary-foreground/60" : "text-muted-foreground"
                            )}>
                              {format(new Date(msg.sentAt), "HH:mm")}
                            </div>
                          </div>
                        )}

                        {/* ── Placeholder image sans data ── */}
                        {!isImage && !isAudio && msg.content === "[Image]" && (
                          <div
                            onClick={() => {
                              setActiveMessageId(isSelected ? null : msg.id);
                              if (!isSelected && window.innerWidth < 768) setMobileTab("agent");
                            }}
                            className="flex items-center gap-2.5 py-0.5"
                          >
                            <div className={cn(
                              "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                              msg.isMe ? "bg-primary-foreground/15" : "bg-muted"
                            )}>
                              <ImagePlus className={cn("h-4 w-4", msg.isMe ? "text-primary-foreground/60" : "text-muted-foreground")} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={cn("text-[13px]", msg.isMe ? "text-primary-foreground/80" : "text-muted-foreground")}>
                                Photo
                              </div>
                              <div className={cn("text-[10px]", msg.isMe ? "text-primary-foreground/50" : "text-muted-foreground/60")}>
                                {format(new Date(msg.sentAt), "HH:mm")}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── Texte normal ── */}
                        {!isImage && !isAudio && msg.content !== "[Image]" && (
                          <div className="group/msg relative">
                            {msg.content}
                            <div className="flex items-center justify-between mt-1.5 gap-2">
                              <button
                                title="Copier ce message"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(msg.content);
                                  toast({ title: "Message copié" });
                                }}
                                className={cn(
                                  "opacity-0 group-hover/msg:opacity-60 hover:!opacity-100 transition-opacity rounded p-0.5",
                                  msg.isMe ? "text-primary-foreground" : "text-muted-foreground"
                                )}
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                              <div className={cn(
                                "text-[10px] text-right",
                                msg.isMe ? "text-primary-foreground/60" : "text-muted-foreground"
                              )}>
                                {format(new Date(msg.sentAt), "HH:mm")}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </div>{/* end waScroll */}

          {/* ── StrategyPanel — analyse message entrant ──────────────────── */}
          {(strategyLoading || strategyResult) && (
            <StrategyPanel
              result={strategyResult ?? {}}
              isLoading={strategyLoading}
              relationId={relationId}
              onDismiss={() => { setStrategyResult(null); setStrategyLoading(false); }}
              onSent={() => loadInitial()}
            />
          )}
        </div>{/* end body (month strip + messages) */}

        {/* ── WA Direct Input bar ──────────────────────────────────────────── */}
        <div className="border-t bg-background/90 backdrop-blur-sm shrink-0">
          {/* Scheduled pending badge */}
          {scheduledPending.length > 0 && (
            <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-700">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="flex-1">
                {scheduledPending.length} message{scheduledPending.length > 1 ? "s" : ""} programmé{scheduledPending.length > 1 ? "s" : ""}
              </span>
              <button
                onClick={() => {
                  scheduledPending.forEach((m) =>
                    fetch(`/api/relations/${relationId}/messages/scheduled/${m.id}`, { method: "DELETE" }).catch(() => {})
                  );
                  setScheduledPending([]);
                }}
                className="underline hover:no-underline"
              >
                Annuler tout
              </button>
            </div>
          )}

          <div className="px-3 py-2 flex items-end gap-2 max-w-3xl mx-auto">
            {/* ⚡ Suggestions */}
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-violet-500 hover:bg-violet-50 h-9 w-9 shrink-0"
              title="Générer une réponse IA"
              onClick={() => setSuggestOpen(true)}
            >
              <Wand2 className="h-4 w-4" />
            </Button>

            {/* Text area */}
            <textarea
              value={waDirectInput}
              onChange={(e) => {
                setWaDirectInput(e.target.value);
                // auto-resize
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              placeholder={
                waLiveStatus === "connected"
                  ? `Message à ${relation?.participantOther ?? "…"}…`
                  : "Ajouter un message à la conversation…"
              }
              className="flex-1 resize-none text-sm bg-muted/60 border rounded-xl px-3 py-2 h-9 max-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-colors leading-5"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleWaDirectSend(waDirectInput, 0);
                }
              }}
            />

            {/* Actions — visible only when text present */}
            {waDirectInput.trim() && (
              <div className="flex items-center gap-1 shrink-0">
                {/* Timer de réponse */}
                <ScheduleTimerPopover
                  onSchedule={(m) => handleWaDirectSend(waDirectInput, m)}
                  disabled={waSendingDirect}
                />

                {/* Send now */}
                <Button
                  size="sm"
                  className="h-9 rounded-xl px-3.5 gap-1.5"
                  onClick={() => handleWaDirectSend(waDirectInput, 0)}
                  disabled={waSendingDirect}
                >
                  {waSendingDirect
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />
                  }
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>{/* end left panel */}

      {/* ── Right — Agent ──────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex-1 flex-col h-full bg-background relative",
          mobileTab === "agent" ? "flex" : "hidden md:flex"
        )}
      >
        {/* Header */}
        <div className="h-16 mt-10 md:mt-0 px-6 flex items-center justify-between border-b shrink-0">
          <div className="flex items-center gap-3 text-primary">
            <Bot className="h-5 w-5" />
            <span className="font-serif font-medium text-lg">Agent ReLink</span>
          </div>
          <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground font-medium">
            {contextLabel}
          </span>
        </div>

        {/* Messages — bottom padding auto-sized from input area height */}
        <div className="relative flex-1 min-h-0">
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-8 z-10 bg-gradient-to-b from-background to-transparent" />
          <div
            ref={agentScrollRef}
            className="h-full overflow-y-auto p-4 md:p-6 space-y-6 pt-6"
            style={{ paddingBottom: inputAreaHeight }}
          >
            <AgentBubble content="Je suis là pour analyser ces échanges avec vous. Sélectionnez un message ou posez une question générale." />

            {localMessages.map((msg) =>
              msg.role === "assistant" ? (
                <AgentBubble key={msg.id} content={msg.content} isStreaming={msg.isStreaming} />
              ) : (
                <UserBubble key={msg.id} content={msg.content} images={msg.images} />
              )
            )}

            {activeMessageId && (
              <div className="animate-in fade-in slide-in-from-bottom-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-amber-700 mb-3 text-sm font-medium">
                  <Sparkles className="h-4 w-4" />
                  Message sélectionné — inclus dans le prochain envoi
                </div>
                <p className="text-sm text-muted-foreground italic mb-3 line-clamp-3">
                  "{waMessages.find((m) => m.id === activeMessageId)?.content}"
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
        </div>

        {/* Input area — measured by ResizeObserver to set paddingBottom above */}
        <div
          ref={inputAreaRef}
          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background/95 to-transparent pt-8 pb-4 px-4 md:px-6"
        >
          <div className="max-w-2xl mx-auto space-y-2">
            {/* Hidden file input — WhatsApp .txt */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
                e.target.value = "";
              }}
            />

            {/* Hidden image input */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                handleImageSelect(e.target.files);
                e.target.value = "";
              }}
            />

            {/* Upload progress panel */}
            {uploadPhase !== "idle" && (
              <div className="animate-in slide-in-from-bottom-2 fade-in bg-card border rounded-2xl overflow-hidden shadow-md">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-primary/5">
                  <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                    {uploadPhase === "done" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <BrainCircuit className="h-3.5 w-3.5 animate-pulse" />
                    )}
                    {uploadPhase === "importing" && "Import en cours…"}
                    {uploadPhase === "building" && "Construction de la mémoire…"}
                    {uploadPhase === "done" && (uploadImported != null ? `Prêt — ${uploadImported.toLocaleString("fr-FR")} messages analysés` : "Mémoire construite ✓")}
                  </span>
                  {uploadPhase === "done" && (
                    <button onClick={() => setUploadPhase("idle")} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  {uploadSteps.map((s, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-2 text-xs transition-opacity",
                        i === uploadSteps.length - 1 && uploadPhase !== "done"
                          ? "text-primary font-medium"
                          : "text-muted-foreground opacity-60"
                      )}
                    >
                      {i < uploadSteps.length - 1 || uploadPhase === "done" ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                      )}
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Paste panel */}
            {pasteOpen && (
              <div className="animate-in slide-in-from-bottom-2 fade-in bg-card border border-amber-200 rounded-2xl overflow-hidden shadow-md">
                <div className="flex items-center justify-between px-4 py-2 border-b border-amber-100 bg-amber-50/60">
                  <span className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Conversation collée — l'agent lira tout ce texte
                  </span>
                  <button
                    onClick={() => {
                      setPasteOpen(false);
                      setPastedConversation("");
                    }}
                    className="text-amber-600 hover:text-amber-900 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Textarea
                  autoFocus
                  placeholder={
                    "Colle ici ta conversation WhatsApp, iMessage, SMS…\n\nEx :\n14/07/2025 18:42 - Alex : T'as vu mon message ?\nMoi : Oui désolé j'étais occupé"
                  }
                  className="min-h-[140px] max-h-52 resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent text-[13px] leading-relaxed font-mono p-4"
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

            {/* Textarea + send */}
            <div className="relative flex flex-col bg-card border rounded-2xl shadow-sm focus-within:ring-1 focus-within:ring-primary/30 transition-shadow overflow-hidden">

              {/* Image previews */}
              {pendingImages.length > 0 && (
                <div className="flex gap-2 px-3 pt-3 flex-wrap">
                  {pendingImages.map((img) => (
                    <div key={img.id} className="relative group shrink-0">
                      <img
                        src={img.previewUrl}
                        alt="aperçu"
                        className="h-16 w-16 object-cover rounded-xl border bg-muted"
                      />
                      <button
                        onClick={() => setPendingImages((prev) => prev.filter((i) => i.id !== img.id))}
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end p-2">
                {/* Upload .txt */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming || uploadPhase !== "idle"}
                  className="self-end mb-1.5 ml-1 h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  title="Importer un export WhatsApp (.txt)"
                >
                  {uploadPhase !== "idle" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="h-4 w-4" />
                  )}
                </button>

                {/* Image upload */}
                <button
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isStreaming || !activeSessionId}
                  className={cn(
                    "self-end mb-1.5 h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0",
                    pendingImages.length > 0
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  )}
                  title="Joindre une image"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>

                {/* Microphone — enregistrement vocal */}
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  disabled={isStreaming || !activeSessionId || isTranscribing}
                  className={cn(
                    "self-end mb-1.5 h-9 w-9 rounded-full flex items-center justify-center transition-all shrink-0",
                    isRecording
                      ? "bg-red-500 text-white animate-pulse shadow-md shadow-red-200"
                      : isTranscribing
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  )}
                  title={isRecording ? "Relâcher pour transcrire" : "Maintenir pour enregistrer"}
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isRecording ? (
                    <Square className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>

                {/* Paste toggle */}
                <button
                  onClick={() => setPasteOpen((o) => !o)}
                  disabled={isStreaming || !activeSessionId}
                  className={cn(
                    "self-end mb-1.5 mr-1 h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0",
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
                  placeholder={
                    pendingImages.length > 0
                      ? "Pose une question sur l'image… (ou envoie directement)"
                      : pastedConversation
                      ? "Ta question sur la conversation collée…"
                      : "Pose une question à ReLink… (Entrée pour envoyer)"
                  }
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
                  disabled={(!chatInput.trim() && pendingImages.length === 0) || isStreaming || !activeSessionId}
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
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentBubble({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
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
          {isStreaming && (
            <span className="inline-block w-[2px] h-4 bg-primary ml-0.5 animate-pulse align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ content, images }: { content: string; images?: PendingImage[] }) {
  return (
    <div className="flex justify-end gap-4 max-w-3xl ml-auto">
      <div className="bg-muted rounded-2xl rounded-tr-sm overflow-hidden">
        {images && images.length > 0 && (
          <div className={cn("flex gap-2 p-2", content.trim() && "pb-1")}>
            {images.map((img) => (
              <img
                key={img.id}
                src={img.previewUrl}
                alt="image jointe"
                className="h-40 max-w-[240px] object-cover rounded-xl"
              />
            ))}
          </div>
        )}
        {content.trim() && (
          <div className="px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        )}
      </div>
    </div>
  );
}
