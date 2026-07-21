import { Link } from "wouter";
import { Sparkles, MessageSquare, BrainCircuit, Clock, Shield, Zap, CheckCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePremium } from "@/hooks/usePremium";

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Analyse de conversations",
    description: "Accède à l'historique complet de ta relation et analyse les dynamiques de pouvoir.",
  },
  {
    icon: Zap,
    title: "Suggestions de réponses IA",
    description: "Génère des réponses stratégiques calquées sur ton style, avec score de pertinence.",
  },
  {
    icon: Clock,
    title: "Timer de réponse",
    description: "Programme tes messages à 30 min, 2h ou 5h pour paraître moins disponible.",
  },
  {
    icon: BrainCircuit,
    title: "Mémoire relationnelle",
    description: "L'IA garde en mémoire les moments-clés de ta relation pour des conseils plus précis.",
  },
  {
    icon: Shield,
    title: "Stratégie No Contact",
    description: "Protocole structuré pour reprendre le contrôle. Toujours gratuit.",
    free: true,
  },
];

export default function Upgrade() {
  const { isPremium } = usePremium();

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-10">
      {/* Back */}
      <Link href="/">
        <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
      </Link>

      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4" />
          ReLink Premium
        </div>
        <h1 className="text-4xl font-serif font-medium tracking-tight">
          {isPremium ? "Tu es déjà Premium ✓" : "Reprends le contrôle de tes relations"}
        </h1>
        <p className="text-lg text-muted-foreground max-w-md mx-auto leading-relaxed">
          {isPremium
            ? "Tu as accès à toutes les fonctionnalités ReLink. Profite bien."
            : "L'IA qui analyse, conseille et t'aide à reprendre la main — sur chaque conversation qui compte."}
        </p>
      </div>

      {/* Features */}
      <div className="grid gap-4">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className={`flex gap-4 p-5 rounded-2xl border transition-all ${
              f.free ? "bg-green-50/50 border-green-100" : "bg-card hover:border-primary/20"
            }`}
          >
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
              f.free ? "bg-green-100" : "bg-primary/10"
            }`}>
              <f.icon className={`h-5 w-5 ${f.free ? "text-green-600" : "text-primary"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">{f.title}</h3>
                {f.free && (
                  <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                    GRATUIT
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{f.description}</p>
            </div>
            <CheckCircle className={`h-5 w-5 shrink-0 mt-0.5 ${f.free ? "text-green-500" : "text-primary/50"}`} />
          </div>
        ))}
      </div>

      {/* CTA */}
      {!isPremium && (
        <div className="bg-card border rounded-2xl p-8 text-center space-y-5">
          <div>
            <div className="text-3xl font-serif font-medium">Bientôt disponible</div>
            <p className="text-muted-foreground mt-2 text-sm">
              ReLink est en cours de lancement. L'abonnement Premium sera disponible très prochainement.
            </p>
          </div>
          <div className="space-y-3">
            <Button
              className="w-full max-w-sm rounded-xl gap-2"
              onClick={() => window.open("mailto:contact@relink.app?subject=Accès Premium ReLink", "_blank")}
            >
              <Sparkles className="h-4 w-4" />
              Demander un accès anticipé
            </Button>
            <p className="text-xs text-muted-foreground">
              Tu recevras un lien d'accès dès le lancement.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
