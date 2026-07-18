import { useListRelations, Relation } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Plus, MessageSquarePlus, Image as ImageIcon, Upload, ChevronRight, Lock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { data: relations, isLoading } = useListRelations();
  const [, setLocation] = useLocation();

  const greeting = "Bonjour";

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto p-6 md:p-12 space-y-12 overflow-y-auto">
      <header className="space-y-3">
        <h1 className="font-serif text-4xl tracking-tight animate-in slide-in-from-bottom-4 fade-in duration-700">
          {greeting}.
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl animate-in slide-in-from-bottom-4 fade-in duration-700 delay-100 fill-mode-both">
          Cet espace est le vôtre. Prenez le temps de déposer ce qui pèse, d'y voir clair, sans jugement.
        </p>
      </header>

      {/* Main Actions */}
      <section className="animate-in slide-in-from-bottom-4 fade-in duration-700 delay-200 fill-mode-both">
        <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-4 flex items-center gap-2">
          <span>Nouvelle analyse</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActionCard 
            title="Importer WhatsApp" 
            description="Analysez l'historique complet d'une relation pour en dégager les schémas."
            icon={Upload}
            onClick={() => setLocation('/relations/new')}
            delay={0}
          />
          <ActionCard 
            title="Coller un message" 
            description="Obtenez une analyse immédiate d'un message reçu."
            icon={MessageSquarePlus}
            onClick={() => setLocation('/relations/new?tab=paste')}
            delay={100}
          />
          <ActionCard 
            title="Capture d'écran" 
            description="Extrayez et analysez une conversation depuis une image."
            icon={ImageIcon}
            onClick={() => setLocation('/relations/new?tab=screenshot')}
            delay={200}
          />
        </div>
      </section>

      {/* Existing Relations */}
      <section className="animate-in slide-in-from-bottom-4 fade-in duration-700 delay-300 fill-mode-both">
        <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-4">
          Vos relations
        </h2>
        
        <div className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : relations && relations.length > 0 ? (
            relations.map((relation) => (
              <RelationCard key={relation.id} relation={relation} />
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-primary/5 p-8 text-center flex flex-col items-center justify-center">
              <div className="h-12 w-12 rounded-full bg-background border flex items-center justify-center mb-4">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg mb-2">Aucune relation enregistrée</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-6">
                Créez une nouvelle relation pour commencer à analyser vos conversations. Toutes vos données restent privées et chiffrées.
              </p>
              <Button onClick={() => setLocation('/relations/new')} variant="outline" className="rounded-full">
                <Plus className="h-4 w-4 mr-2" />
                Commencer
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ActionCard({ 
  title, 
  description, 
  icon: Icon, 
  onClick,
  delay
}: { 
  title: string; 
  description: string; 
  icon: any; 
  onClick: () => void;
  delay: number;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border bg-card text-left transition-all hover:shadow-lg hover:-translate-y-1 overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="h-10 w-10 rounded-full bg-primary/5 flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-medium text-base mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </button>
  );
}

function RelationCard({ relation }: { relation: Relation }) {
  return (
    <Link
      href={`/relations/${relation.id}`}
      className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border bg-card hover:border-primary/20 transition-all hover:shadow-md"
    >
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-serif text-xl">{relation.name}</h3>
          {relation.status === 'active' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary/10 text-secondary-foreground border border-secondary/20">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary"></span>
              Active
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {relation.messageCount} messages au total
          {relation.lastMessageAt && (
            <> · Dernier message {formatDistanceToNow(new Date(relation.lastMessageAt), { addSuffix: true, locale: fr })}</>
          )}
        </p>
      </div>
      
      <div className="flex items-center text-sm font-medium text-primary opacity-80 group-hover:opacity-100 transition-opacity">
        Continuer avec ReLink
        <ChevronRight className="ml-1 h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
      </div>
    </Link>
  );
}
