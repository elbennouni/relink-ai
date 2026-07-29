import { useEffect, useState, useRef } from "react";
import { useParams } from "wouter";
import { useGetRelation } from "@workspace/api-client-react";
import {
  Smartphone, CheckCircle2, Loader2, Trash2, Copy, ExternalLink,
  ShieldCheck, Mic, Zap, Info, QrCode, Building2, RefreshCw, Wifi, WifiOff,
  History, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Tab = "qr" | "business";
type HistoryPeriod = "0" | "1" | "7" | "60" | "180" | "3650";

const HISTORY_OPTIONS: { value: HistoryPeriod; label: string; desc: string }[] = [
  { value: "0",    label: "Aucun",      desc: "Temps réel seulement" },
  { value: "1",    label: "Aujourd'hui", desc: "Dernières 24h" },
  { value: "7",    label: "1 semaine",  desc: "7 derniers jours" },
  { value: "60",   label: "2 mois",     desc: "60 derniers jours" },
  { value: "180",  label: "6 mois",     desc: "180 derniers jours" },
  { value: "3650", label: "Tout",       desc: "Historique complet" },
];

// ─── QR Code Tab ─────────────────────────────────────────────────────────────

function QRTab({ relationId, relationName }: { relationId: number; relationName: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"none" | "connecting" | "qr" | "connected" | "disconnected" | "failed">("none");
  const [qrData, setQrData] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState("");
  const [savedContact, setSavedContact] = useState<string | undefined>();
  const [disconnecting, setDisconnecting] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("60");
  const [historyImporting, setHistoryImporting] = useState<{ total: number } | null>(null);
  const [historyDone, setHistoryDone] = useState<{ imported: number } | null>(null);
  const [retryCountdown, setRetryCountdown] = useState(0); // seconds remaining before retry allowed
  const sseRef = useRef<EventSource | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up countdown on unmount
  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  // Check initial status, then open SSE to stay live
  useEffect(() => {
    fetch(`/api/relations/${relationId}/whatsapp/status`)
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.status ?? "none");
        if (d.contactPhone) setSavedContact(d.contactPhone);
        // For connecting/qr states, subscribe immediately.
        // For connected, re-subscribe so we get future disconnection events
        // (without historyDays the server sends "connected" + keeps connection open
        //  until the session disconnects or this client leaves).
        if (d.status === "connected" || d.status === "connecting" || d.status === "qr") {
          startSSELive();
        }
      })
      .catch(() => {});
  }, [relationId]);

  /** Subscribe for live state updates WITHOUT changing current status.
   *  Used on page load when the session is already "connected" — we keep
   *  the SSE open so the UI learns about future disconnection events. */
  const startSSELive = () => {
    sseRef.current?.close();
    const es = new EventSource(`/api/relations/${relationId}/whatsapp/qr`);
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "disconnected") {
          setStatus(data.loggedOut ? "none" : "disconnected");
          setQrData(null);
          es.close();
        }
        // "connected" confirmation → no status change needed
      } catch {}
    };
    es.onerror = () => {
      es.close();
      // Use functional update to read the latest status at error time
      setStatus((prev) => (prev === "connected" ? "disconnected" : prev));
    };
  };

  const startSSE = (phone?: string, days?: string) => {
    sseRef.current?.close();
    setQrData(null);
    setHistoryImporting(null);
    setHistoryDone(null);
    setStatus("connecting");

    const params = new URLSearchParams();
    if (phone) params.set("contactPhone", phone);
    if (days !== undefined) params.set("historyDays", days);
    const qs = params.toString();
    const url = `/api/relations/${relationId}/whatsapp/qr${qs ? `?${qs}` : ""}`;
    const es = new EventSource(url);
    sseRef.current = es;

    // Local flags — not React state, so no stale-closure risk.
    // receivedConnected: true once we get a "connected" event on THIS SSE instance.
    // receivedHistoryDone: true once history import finished on THIS SSE instance.
    let receivedConnected = false;
    let receivedHistoryDone = false;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "qr") {
          setStatus("qr");
          setQrData(data.data);
        } else if (data.type === "connected") {
          receivedConnected = true;
          setStatus("connected");
          setQrData(null);
          toast({ title: "WhatsApp connecté ✓", description: "Les messages arrivent en temps réel." });
        } else if (data.type === "history-importing") {
          setHistoryImporting({ total: data.total });
        } else if (data.type === "history-done") {
          receivedHistoryDone = true;
          setHistoryImporting(null);
          setHistoryDone({ imported: data.imported });
          if (data.imported > 0) {
            toast({ title: `Historique importé ✓`, description: `${data.imported} messages chargés.` });
          }
          es.close();
        } else if (data.type === "disconnected") {
          setStatus(data.loggedOut ? "none" : "disconnected");
          setQrData(null);
          es.close();
        } else if (data.type === "failed") {
          setStatus("failed");
          setQrData(null);
          es.close();
          // Start countdown if the server sent a retryAfter value
          if (data.retryAfter && data.retryAfter > 0) {
            setRetryCountdown(data.retryAfter);
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownRef.current = setInterval(() => {
              setRetryCountdown((s) => {
                if (s <= 1) { clearInterval(countdownRef.current!); return 0; }
                return s - 1;
              });
            }, 1000);
          }
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      es.close();
      if (receivedConnected && !receivedHistoryDone) {
        // SSE proxy timeout (Replit 5-min limit) while waiting for history on an
        // already-connected session — reopen so we catch the "history-done" event.
        // Only auto-reconnect when we ACTUALLY received "connected" on this instance,
        // not when status was "connected" before the user clicked (stale closure bug).
        setTimeout(() => {
          if (sseRef.current === es) {
            startSSE(phone || undefined, days);
          }
        }, 2000);
      } else {
        setStatus("disconnected");
      }
    };
  };

  const handleConnect = () => {
    const phone = contactPhone.replace(/\D/g, "");
    if (phone) setSavedContact(phone);
    startSSE(phone || undefined, historyPeriod);
  };

  const handleDisconnect = async () => {
    if (!confirm("Déconnecter ce compte WhatsApp ? La session sera supprimée.")) return;
    setDisconnecting(true);
    sseRef.current?.close();
    try {
      await fetch(`/api/relations/${relationId}/whatsapp/disconnect-qr`, { method: "POST" });
      setStatus("none");
      setQrData(null);
      setSavedContact(undefined);
      setContactPhone("");
      setHistoryDone(null);
      toast({ title: "Déconnecté" });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  useEffect(() => () => { sseRef.current?.close(); }, []);

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 rounded-xl p-4 text-sm space-y-2">
        <p className="font-semibold flex items-center gap-2"><QrCode className="h-4 w-4 text-primary" /> Comment ça marche</p>
        <ol className="space-y-1 text-muted-foreground text-xs list-decimal list-inside">
          <li>Saisis le numéro de {relationName} (pour filtrer uniquement vos échanges)</li>
          <li>Choisis combien d'historique importer</li>
          <li>Clique sur "Générer le QR code"</li>
          <li>Ouvre WhatsApp → Appareils connectés → Connecter un appareil et scanne</li>
        </ol>
      </div>

      {status === "none" || status === "disconnected" || status === "failed" ? (
        <div className="bg-card border rounded-2xl p-5 space-y-4">
          {status === "disconnected" && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              Connexion perdue. Reconnecte-toi.
            </div>
          )}
          {status === "failed" && (
            <div className="flex flex-col gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 font-medium">
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                WhatsApp a rejeté la connexion — trop de tentatives d'enregistrement.
              </div>
              {retryCountdown > 0 ? (
                <p className="text-red-600 pl-5">
                  Réessaie dans <span className="font-bold tabular-nums">{Math.floor(retryCountdown / 60)}:{String(retryCountdown % 60).padStart(2, "0")}</span>
                  {" "}— chaque tentative prématurée rallonge le blocage.
                </p>
              ) : (
                <p className="text-red-600 pl-5">Tu peux réessayer maintenant.</p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Numéro de {relationName}</label>
            <input
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="+33 6 12 34 56 78 (optionnel)"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Laisse vide pour capturer tous les contacts</p>
          </div>

          {/* History period selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-primary" /> Historique à importer
            </label>
            <div className="grid grid-cols-6 gap-1.5">
              {HISTORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setHistoryPeriod(opt.value)}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-2 py-2.5 text-center transition-all",
                    historyPeriod === opt.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40"
                  )}
                >
                  <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                  <span className="text-[10px] leading-tight mt-0.5 opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
            {historyPeriod !== "0" && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Download className="h-3 w-3" />
                WhatsApp synchronisera les {HISTORY_OPTIONS.find(o => o.value === historyPeriod)?.desc} après la connexion.
              </p>
            )}
          </div>

          <Button onClick={handleConnect} className="w-full" disabled={retryCountdown > 0}>
            <QrCode className="h-4 w-4 mr-2" />
            {retryCountdown > 0
              ? `Patienter ${Math.floor(retryCountdown / 60)}:${String(retryCountdown % 60).padStart(2, "0")}…`
              : "Générer le QR code"}
          </Button>
        </div>
      ) : status === "connecting" ? (
        <div className="bg-card border rounded-2xl p-8 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="font-semibold">Connexion en cours…</p>
          <p className="text-xs text-muted-foreground">Génération du QR code</p>
        </div>
      ) : status === "qr" ? (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="p-5 flex flex-col items-center gap-3">
            <p className="text-sm font-semibold">Scanne avec ton téléphone</p>
            <p className="text-xs text-muted-foreground">WhatsApp → Appareils connectés → Connecter un appareil</p>
            {qrData && (
              <img
                src={qrData}
                alt="QR Code WhatsApp"
                className="w-52 h-52 rounded-xl border shadow-sm"
              />
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" /> En attente du scan…
            </div>
            <Button variant="outline" size="sm" onClick={handleConnect} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Actualiser le QR
            </Button>
          </div>
        </div>
      ) : status === "connected" ? (
        <div className="space-y-3">
          {historyImporting && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">Import de l'historique en cours…</p>
                <p className="text-xs text-blue-700">{historyImporting.total} messages à traiter</p>
              </div>
            </div>
          )}
          {historyDone && historyDone.imported > 0 && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {historyDone.imported} messages importés depuis l'historique
            </div>
          )}
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
            <div className="relative">
              <Smartphone className="h-5 w-5 text-green-700" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
                <Wifi className="h-3.5 w-3.5" /> Session active
              </p>
              {savedContact && (
                <p className="text-xs text-green-700">Filtré sur : +{savedContact}</p>
              )}
              <p className="text-xs text-green-700">Les messages arrivent en temps réel</p>
            </div>
            <Button
              variant="ghost" size="icon"
              className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>

          {/* History import while connected */}
          {!historyImporting && (
            <div className="bg-card border rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <History className="h-3.5 w-3.5 text-primary" /> Importer l'historique
              </p>
              <div className="grid grid-cols-6 gap-1.5">
                {HISTORY_OPTIONS.filter(o => o.value !== "0").map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setHistoryPeriod(opt.value)}
                    className={cn(
                      "flex flex-col items-center rounded-xl border px-2 py-2.5 text-center transition-all",
                      historyPeriod === opt.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                    <span className="text-[10px] leading-tight mt-0.5 opacity-70">{opt.desc}</span>
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => {
                  const phone = savedContact || contactPhone.replace(/\D/g, "");
                  startSSE(phone || undefined, historyPeriod !== "0" ? historyPeriod : "60");
                }}
              >
                <Download className="h-3.5 w-3.5" /> Synchroniser l'historique
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Business API Tab ─────────────────────────────────────────────────────────

type BizConfig = { configured: boolean; phoneNumberId?: string; contactPhone?: string };
type FormState = { phoneNumberId: string; accessToken: string; businessAccountId: string; contactPhone: string };

function BusinessAPITab({ relationId, relationName }: { relationId: number; relationName: string }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<BizConfig | null>(null);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ phoneNumberId: "", accessToken: "", businessAccountId: "", contactPhone: "" });

  useEffect(() => {
    fetch(`/api/relations/${relationId}/whatsapp/config`)
      .then((r) => r.json())
      .then((d) => { setConfig(d); if (!d.configured) setShowForm(false); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [relationId]);

  const webhookUrl = `${window.location.origin}/api/webhook/whatsapp`;

  const handleSave = async () => {
    if (!form.phoneNumberId || !form.accessToken) {
      toast({ title: "Champs manquants", description: "Phone Number ID et Access Token sont requis.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/relations/${relationId}/whatsapp/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setVerifyToken(data.verifyToken);
      setConfig({ configured: true, phoneNumberId: form.phoneNumberId, contactPhone: form.contactPhone });
      setShowForm(false);
      toast({ title: "WhatsApp Business connecté ✓" });
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Erreur inconnue", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Déconnecter WhatsApp Business ?")) return;
    setDeleting(true);
    try {
      await fetch(`/api/relations/${relationId}/whatsapp/config`, { method: "DELETE" });
      setConfig({ configured: false });
      setVerifyToken(null);
      setShowForm(false);
      toast({ title: "Déconnecté" });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ title: `${label} copié ✓` }));
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Nécessite un <strong>compte Meta Business vérifié</strong> et un numéro dédié (distinct de ton compte perso). Capture uniquement les nouveaux messages.</span>
      </div>

      {!config?.configured && !showForm && (
        <div className="bg-card border rounded-2xl p-6 text-center space-y-3">
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto" />
          <div>
            <p className="font-semibold">API Business non configurée</p>
            <p className="text-sm text-muted-foreground">Connecte un compte WhatsApp Business officiel</p>
          </div>
          <Button onClick={() => setShowForm(true)}>Configurer l'API Business</Button>
        </div>
      )}

      {showForm && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="bg-muted/40 px-5 py-3 border-b space-y-1">
            <p className="text-xs font-semibold">IDENTIFIANTS META BUSINESS</p>
            <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Guide Meta <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="p-5 space-y-4">
            {[
              { key: "phoneNumberId", label: "Phone Number ID *", placeholder: "123456789012345", hint: "Meta Dashboard → WhatsApp → Configuration → Phone Number ID", type: "text" },
              { key: "accessToken", label: "Access Token permanent *", placeholder: "EAAxxxxx…", hint: "System User Token avec permission whatsapp_business_messaging", type: "password" },
              { key: "businessAccountId", label: "WABA ID", placeholder: "optionnel", hint: "", type: "text" },
              { key: "contactPhone", label: `Numéro de ${relationName}`, placeholder: "+33612345678", hint: "Pour distinguer qui envoie quoi", type: "text" },
            ].map(({ key, label, placeholder, hint, type }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs font-semibold">{label}</label>
                <input
                  type={type}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={placeholder}
                  value={form[key as keyof FormState]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
                {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">Annuler</Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {saving ? "Enregistrement…" : "Connecter"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {config?.configured && !showForm && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-800">API Business connectée</p>
              <p className="text-xs text-green-700 truncate">Phone Number ID : {config.phoneNumberId}</p>
            </div>
            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>

          {/* Webhook config */}
          <div className="bg-card border rounded-2xl overflow-hidden">
            <div className="bg-muted/40 px-4 py-2.5 border-b">
              <p className="text-xs font-semibold text-muted-foreground">WEBHOOK À COLLER DANS META</p>
            </div>
            <div className="p-4 space-y-3">
              {[
                { label: "URL du webhook", value: webhookUrl },
                ...(verifyToken ? [{ label: "Token de vérification", value: verifyToken }] : []),
                { label: "Champ souscrit", value: "messages" },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">{label}</label>
                  <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
                    <code className="flex-1 text-xs break-all">{value}</code>
                    <button onClick={() => copy(value, label)} className="shrink-0 text-muted-foreground hover:text-foreground">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {!verifyToken && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  Pour récupérer le token de vérification, supprime et reconfigure la connexion.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WhatsAppConfig() {
  const params = useParams<{ id: string }>();
  const relationId = Number(params.id);
  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const [tab, setTab] = useState<Tab>("qr");
  const name = relation?.name ?? "le contact";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          <Smartphone className="h-3.5 w-3.5" /> WhatsApp
        </div>
        <h1 className="text-2xl font-bold">Connexion WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Capture automatique des messages avec <span className="font-semibold text-foreground">{name}</span>. Les vocaux sont transcrits par IA.
        </p>
      </div>

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Zap, label: "Temps réel", desc: "Messages capturés instantanément" },
          { icon: Mic, label: "Vocaux", desc: "Transcription automatique" },
          { icon: ShieldCheck, label: "Sécurisé", desc: "Connexion chiffrée" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="bg-muted/40 rounded-xl p-3 space-y-1">
            <Icon className="h-4 w-4 text-primary" />
            <div className="text-xs font-semibold">{label}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1">
        {([
          { id: "qr", label: "QR Code", icon: QrCode, desc: "Compte perso" },
          { id: "business", label: "API Business", icon: Building2, desc: "Compte pro" },
        ] as const).map(({ id, label, icon: Icon, desc }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
              tab === id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            <span className={cn("text-xs", tab === id ? "text-muted-foreground" : "text-muted-foreground/50")}>— {desc}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "qr"
        ? <QRTab relationId={relationId} relationName={name} />
        : <BusinessAPITab relationId={relationId} relationName={name} />
      }
    </div>
  );
}
