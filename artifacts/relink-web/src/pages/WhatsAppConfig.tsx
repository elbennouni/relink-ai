import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useGetRelation } from "@workspace/api-client-react";
import {
  Smartphone, CheckCircle2, Loader2, Trash2, Copy, ExternalLink,
  ShieldCheck, Mic, Zap, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Config = {
  configured: boolean;
  phoneNumberId?: string;
  contactPhone?: string;
};

type FormState = {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string;
  contactPhone: string;
};

export default function WhatsAppConfig() {
  const params = useParams<{ id: string }>();
  const relationId = Number(params.id);
  const { toast } = useToast();
  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });

  const [config, setConfig] = useState<Config | null>(null);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [step, setStep] = useState<"idle" | "form" | "done">("idle");

  const [form, setForm] = useState<FormState>({
    phoneNumberId: "",
    accessToken: "",
    businessAccountId: "",
    contactPhone: "",
  });

  useEffect(() => {
    if (!relationId) return;
    fetch(`/api/relations/${relationId}/whatsapp/config`)
      .then((r) => r.json())
      .then((d) => {
        setConfig(d);
        if (d.configured) setStep("done");
        else setStep("idle");
      })
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
      setStep("done");
      toast({ title: "WhatsApp connecté ✓", description: "Les nouveaux messages seront capturés automatiquement." });
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Erreur inconnue", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Déconnecter WhatsApp ? Les messages déjà importés restent.")) return;
    setDeleting(true);
    try {
      await fetch(`/api/relations/${relationId}/whatsapp/config`, { method: "DELETE" });
      setConfig({ configured: false });
      setVerifyToken(null);
      setStep("idle");
      setForm({ phoneNumberId: "", accessToken: "", businessAccountId: "", contactPhone: "" });
      toast({ title: "WhatsApp déconnecté" });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: `${label} copié ✓` })
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          <Smartphone className="h-3.5 w-3.5" />
          WhatsApp Business
        </div>
        <h1 className="text-2xl font-bold">Connexion directe WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Chaque message échangé avec{" "}
          <span className="font-semibold text-foreground">{relation?.name ?? "…"}</span>{" "}
          sera capturé automatiquement. Les vocaux sont transcrits par IA.
        </p>
      </div>

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Zap, label: "Temps réel", desc: "Messages capturés instantanément" },
          { icon: Mic, label: "Vocaux", desc: "Transcription automatique Whisper" },
          { icon: ShieldCheck, label: "Sécurisé", desc: "Signature Meta vérifiée" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="bg-muted/40 rounded-xl p-3 space-y-1">
            <Icon className="h-4 w-4 text-primary" />
            <div className="text-xs font-semibold">{label}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
        ))}
      </div>

      {/* Warning */}
      <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          L'API WhatsApp Business capture uniquement les <strong>nouveaux messages</strong> à partir de la connexion.
          Pour l'historique existant, utilise l'import de fichier .txt depuis l'onglet Conversation.
        </span>
      </div>

      {step === "idle" && (
        <div className="bg-card border rounded-2xl p-6 text-center space-y-3">
          <Smartphone className="h-10 w-10 text-muted-foreground mx-auto" />
          <div>
            <p className="font-semibold">Pas encore connecté</p>
            <p className="text-sm text-muted-foreground">Configure ton compte Meta Business pour commencer</p>
          </div>
          <Button onClick={() => setStep("form")}>Connecter WhatsApp Business</Button>
        </div>
      )}

      {step === "form" && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          {/* Steps guide */}
          <div className="bg-muted/40 px-5 py-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground">PRÉREQUIS META</p>
            <ol className="mt-1.5 space-y-1 text-xs text-muted-foreground list-decimal list-inside">
              <li>Compte Meta Business vérifié avec WhatsApp Business Platform activée</li>
              <li>Application Meta avec un numéro WhatsApp Business dédié</li>
              <li>Token d'accès permanent (System User Token)</li>
            </ol>
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
            >
              Guide Meta <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Phone Number ID *</label>
              <input
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="123456789012345"
                value={form.phoneNumberId}
                onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Meta Dashboard → WhatsApp → Configuration → Phone Number ID</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Access Token permanent *</label>
              <input
                type="password"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="EAAxxxxx..."
                value={form.accessToken}
                onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">System User Token avec permissions whatsapp_business_messaging</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">WhatsApp Business Account ID</label>
              <input
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="123456789012345 (optionnel)"
                value={form.businessAccountId}
                onChange={(e) => setForm((f) => ({ ...f, businessAccountId: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">
                Numéro de téléphone du contact
              </label>
              <input
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="+33612345678"
                value={form.contactPhone}
                onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Numéro de {relation?.name ?? "la personne"} — sert à distinguer qui envoie quoi
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep("idle")} className="flex-1">
                Annuler
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {saving ? "Enregistrement…" : "Connecter"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-800">WhatsApp connecté</p>
              <p className="text-xs text-green-700 truncate">Phone Number ID : {config?.phoneNumberId}</p>
              {config?.contactPhone && (
                <p className="text-xs text-green-700">Contact : {config.contactPhone}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>

          {/* Webhook config */}
          <div className="bg-card border rounded-2xl overflow-hidden">
            <div className="bg-muted/40 px-4 py-2.5 border-b">
              <p className="text-xs font-semibold text-muted-foreground">CONFIGURATION WEBHOOK META</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Colle ces valeurs dans Meta Dashboard → WhatsApp → Configuration → Webhook
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">URL du webhook</label>
                <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs break-all">{webhookUrl}</code>
                  <button
                    onClick={() => copy(webhookUrl, "URL")}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Token de vérification</label>
                {verifyToken ? (
                  <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
                    <code className="flex-1 text-xs break-all">{verifyToken}</code>
                    <button
                      onClick={() => copy(verifyToken, "Token")}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                    Le token de vérification a été généré lors de la configuration initiale.
                    Pour le récupérer, supprime et reconfigure la connexion.
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Champ souscrit</label>
                <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs">messages</code>
                  <button
                    onClick={() => copy("messages", "Champ")}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center">
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Comment configurer le webhook Meta <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
