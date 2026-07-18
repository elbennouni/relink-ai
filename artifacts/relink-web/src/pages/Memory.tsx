import { useEffect, useState, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useGetRelation, 
  useGetMemory, 
  useGetDynamicReport,
  useGetRelationPhases
} from "@workspace/api-client-react";
import { BrainCircuit, Clock, AlertCircle, MessageCircle, RefreshCcw, Info } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function Memory() {
  const params = useParams();
  const relationId = Number(params.id);
  const [, setLocation] = useLocation();

  const { data: relation } = useGetRelation(relationId, { query: { enabled: !!relationId } });
  const { data: memory } = useGetMemory(relationId, { query: { enabled: !!relationId } });
  const { data: report } = useGetDynamicReport(relationId, { query: { enabled: !!relationId } });
  const { data: phases } = useGetRelationPhases(relationId, { query: { enabled: !!relationId } });

  if (!relation || !memory || !report) {
    return <div className="p-12 flex justify-center"><RefreshCcw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-8 space-y-12 overflow-y-auto">
      {/* Header */}
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-serif text-3xl tracking-tight">{relation.name}</h1>
            <p className="text-muted-foreground text-sm">Mémoire relationnelle · Mise à jour {memory.builtAt ? format(new Date(memory.builtAt), "le dd MMM à HH:mm", { locale: fr }) : "récemment"}</p>
          </div>
        </div>
      </header>

      {/* Overview */}
      <section className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-card border rounded-3xl p-6 md:p-8 space-y-4">
            <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              Résumé Global
            </h2>
            <p className="text-lg leading-relaxed">
              {memory.globalSummary || "Aucun résumé disponible."}
            </p>
          </div>
          
          <div className="bg-secondary/5 border border-secondary/20 rounded-3xl p-6 space-y-4">
             <h2 className="text-sm font-medium tracking-wide uppercase text-secondary-foreground flex items-center gap-2">
              Phase Actuelle
            </h2>
            <p className="text-xl font-serif text-primary">
              {memory.currentPhase || "En transition"}
            </p>
            {report.recentChanges && (
              <p className="text-sm text-muted-foreground">{report.recentChanges}</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border rounded-3xl p-6">
             <h3 className="text-xs font-medium uppercase text-muted-foreground mb-4">Sujets récurrents</h3>
             <div className="flex flex-wrap gap-2">
               {memory.recurringTopics?.map(topic => (
                 <span key={topic} className="px-3 py-1.5 bg-muted rounded-full text-xs font-medium">
                   {topic}
                 </span>
               ))}
               {!memory.recurringTopics?.length && <span className="text-sm text-muted-foreground">Aucun sujet détecté</span>}
             </div>
          </div>

          <div className="bg-card border rounded-3xl p-6 border-l-4 border-l-destructive/50">
             <h3 className="text-xs font-medium uppercase text-muted-foreground mb-4 flex items-center gap-1.5">
               <AlertCircle className="h-3.5 w-3.5" />
               Limites exprimées
             </h3>
             <ul className="space-y-3 text-sm">
               {memory.expressedLimits?.map((limit, i) => (
                 <li key={i} className="flex gap-2">
                   <span className="text-destructive font-bold">•</span> 
                   <span className="leading-snug">{limit}</span>
                 </li>
               ))}
               {!memory.expressedLimits?.length && <li className="text-muted-foreground">Aucune limite claire détectée.</li>}
             </ul>
          </div>
        </div>
      </section>

      {/* Dynamics */}
      <section className="space-y-6">
        <h2 className="text-2xl font-serif">Dynamique de communication</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-card border rounded-2xl p-5 space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase">Initiative</span>
            <p className="font-medium">{report.whoInitiates || "Équilibrée"}</p>
          </div>
          <div className="bg-card border rounded-2xl p-5 space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase">Réponse</span>
            <p className="font-medium">{report.avgResponseTime || "Variable"}</p>
          </div>
          <div className="bg-card border rounded-2xl p-5 space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase">Fréquence</span>
            <p className="font-medium">{report.messageFrequency || "Non définie"}</p>
          </div>
        </div>
      </section>

      {/* Deep Analysis */}
      <section className="grid md:grid-cols-2 gap-8 pt-4">
        <div className="space-y-4">
          <h3 className="font-medium text-lg flex items-center gap-2 border-b pb-2">
            Ce que l'on observe (Faits)
          </h3>
          <ul className="space-y-3">
            {report.observableFacts?.map((fact, i) => (
              <li key={i} className="flex gap-3 text-sm bg-muted/30 p-3 rounded-lg">
                <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span className="leading-relaxed">{fact}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <h3 className="font-medium text-lg flex items-center gap-2 border-b pb-2 text-muted-foreground">
            Interprétations possibles
          </h3>
          <ul className="space-y-3">
            {report.hypotheses?.map((hyp, i) => (
              <li key={i} className="flex gap-3 text-sm border p-3 rounded-lg text-muted-foreground">
                <span className="font-serif italic opacity-50">?</span>
                <span className="leading-relaxed">{hyp}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      
      {/* Timeline */}
      {phases && phases.length > 0 && (
        <section className="space-y-6 pt-8">
          <h2 className="text-2xl font-serif">Historique des phases</h2>
          <div className="relative border-l border-border ml-3 space-y-8 pb-8">
            {phases.map((phase) => (
              <div key={phase.id} className="relative pl-6">
                <div className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background ${phase.isCurrentPhase ? 'bg-secondary' : 'bg-muted-foreground'}`}></div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className={`font-medium ${phase.isCurrentPhase ? 'text-foreground' : 'text-muted-foreground'}`}>{phase.label}</h4>
                    {phase.isCurrentPhase && <span className="text-[10px] uppercase font-bold bg-secondary/10 text-secondary-foreground px-2 py-0.5 rounded-full">Actuelle</span>}
                  </div>
                  <p className="text-sm text-muted-foreground">{phase.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
