import { ReactNode } from "react";
import { Link } from "wouter";
import { Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePremium } from "@/hooks/usePremium";

interface PaywallGateProps {
  children: ReactNode;
  /** Custom message shown in the paywall banner */
  message?: string;
}

/**
 * PaywallGate — wraps a page/component.
 * - If the user is premium → renders children normally.
 * - If not → renders a blurred preview with an upgrade CTA overlay.
 */
export function PaywallGate({ children, message }: PaywallGateProps) {
  const { isPremium, isLoaded } = usePremium();

  if (!isLoaded) return null; // avoid flash

  if (isPremium) return <>{children}</>;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Blurred content preview */}
      <div className="pointer-events-none select-none blur-sm opacity-50 h-full w-full overflow-hidden">
        {children}
      </div>

      {/* Overlay CTA */}
      <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/60 backdrop-blur-sm">
        <div className="max-w-sm w-full mx-4 bg-card border rounded-2xl shadow-xl p-8 flex flex-col items-center text-center gap-5">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">Fonctionnalité Premium</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {message ?? "Cette fonctionnalité est réservée aux abonnés ReLink Premium. Débloquez l'accès pour analyser vos relations et envoyer des messages stratégiques."}
            </p>
          </div>
          <Button asChild className="w-full rounded-xl gap-2">
            <Link href="/upgrade">
              <Sparkles className="h-4 w-4" />
              Passer à Premium
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            L'onglet <strong>No Contact</strong> reste toujours gratuit.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight inline paywall badge — use inside a component to gate a specific action
 * (e.g. a button) rather than a whole page.
 */
export function PaywallBadge({ children }: { children: ReactNode }) {
  const { isPremium } = usePremium();
  if (isPremium) return <>{children}</>;
  return (
    <Link href="/upgrade">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 rounded-full px-2.5 py-1 cursor-pointer hover:bg-primary/20 transition-colors">
        <Sparkles className="h-3 w-3" />
        Premium
      </span>
    </Link>
  );
}
