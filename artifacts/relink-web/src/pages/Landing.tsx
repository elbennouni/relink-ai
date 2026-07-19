import { Link } from 'wouter';
import { ShieldCheck, Brain, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Landing() {
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center min-h-[100dvh] px-6 py-16 bg-background overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-12">
        <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
          <div className="h-4 w-4 rounded-full bg-secondary" />
        </div>
        <span className="font-serif text-2xl font-medium tracking-tight">ReLink</span>
      </div>

      {/* Hero */}
      <div className="max-w-2xl text-center space-y-6 mb-14">
        <h1 className="font-serif text-5xl md:text-6xl tracking-tight leading-tight animate-in slide-in-from-bottom-4 fade-in duration-700">
          Comprenez vos relations.
          <br />
          <span className="text-muted-foreground">Sans jugement.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto animate-in slide-in-from-bottom-4 fade-in duration-700 delay-100 fill-mode-both">
          ReLink analyse vos conversations WhatsApp pour vous aider à y voir clair — schémas, dynamiques, mémoire relationnelle. Un espace privé, chiffré, entièrement à vous.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3 mb-16 animate-in slide-in-from-bottom-4 fade-in duration-700 delay-200 fill-mode-both">
        <Link href="/sign-up">
          <Button size="lg" className="rounded-full px-8 text-base font-medium">
            Commencer gratuitement
          </Button>
        </Link>
        <Link href="/sign-in">
          <Button size="lg" variant="outline" className="rounded-full px-8 text-base font-medium">
            Se connecter
          </Button>
        </Link>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl w-full animate-in slide-in-from-bottom-4 fade-in duration-700 delay-300 fill-mode-both">
        {[
          {
            icon: Brain,
            title: 'Mémoire relationnelle',
            desc: "L'IA construit une carte mentale de votre relation au fil du temps.",
          },
          {
            icon: MessageSquare,
            title: 'Analyse en profondeur',
            desc: 'Identifiez les schémas, les phases et les dynamiques de vos échanges.',
          },
          {
            icon: ShieldCheck,
            title: 'Privé et sécurisé',
            desc: 'Vos conversations ne quittent jamais votre espace personnel.',
          },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="p-6 rounded-2xl border bg-card text-left space-y-3">
            <div className="h-10 w-10 rounded-full bg-primary/5 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-medium">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
