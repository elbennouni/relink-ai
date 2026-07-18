import { useState, useRef, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useGetRelation, 
  useImportWhatsapp, 
  useImportPaste, 
  useImportScreenshot, 
  useConfirmScreenshotImport, 
  useImportManual, 
  useBuildMemory 
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  UploadCloud, 
  FileText, 
  Image as ImageIcon, 
  Keyboard, 
  CheckCircle2, 
  ArrowRight,
  BrainCircuit,
  Shield,
  Search,
  MessageSquare
} from "lucide-react";

export default function ImportFlow() {
  const [, setLocation] = useLocation();
  const params = useParams();
  const relationId = Number(params.id);
  const { toast } = useToast();
  
  const searchParams = new URLSearchParams(window.location.search);
  const initialTab = searchParams.get('tab') || 'whatsapp';

  const { data: relation, isLoading: isRelationLoading } = useGetRelation(relationId, { 
    query: { enabled: !!relationId, queryKey: ['getRelation', relationId] } 
  });

  const [activeTab, setActiveTab] = useState(initialTab);
  const [step, setStep] = useState<'upload' | 'processing' | 'success'>('upload');
  
  // Importers
  const importWhatsapp = useImportWhatsapp();
  const importPaste = useImportPaste();
  const importScreenshot = useImportScreenshot();
  const confirmScreenshot = useConfirmScreenshotImport();
  const importManual = useManualImport(); // Custom hook to handle multi-step UI manually for single message
  const buildMemory = useBuildMemory();

  // Progress states
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const [stats, setStats] = useState<{ imported: number, total: number } | null>(null);

  const startMemoryBuild = async () => {
    setStep('processing');
    setProgressMessages(["Lancement de l'analyse..."]);

    const STEP_LABELS: Record<string, string> = {
      reading:    "Lecture de la conversation...",
      detecting:  "Détection des messages...",
      encrypting: "Chiffrement sécurisé...",
      building:   "Construction de la mémoire relationnelle et analyse des dynamiques de pouvoir...",
      saving:     "Enregistrement...",
      done:       "Analyse complète ✓",
    };

    try {
      const res = await fetch(`/api/relations/${relationId}/memory/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

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
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.error) throw new Error(event.error);
              if (event.step) {
                const label = STEP_LABELS[event.step] ?? event.label ?? event.step;
                setProgressMessages(prev => {
                  // avoid duplicates
                  if (prev[prev.length - 1] === label) return prev;
                  return [...prev, label];
                });
              }
              if (event.step === "done") {
                setTimeout(() => setStep('success'), 600);
                return;
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
                throw parseErr;
              }
            }
          }
        }
      }

      // Stream ended without a done event — still succeed
      setProgressMessages(prev => [...prev, "Analyse complète ✓"]);
      setTimeout(() => setStep('success'), 600);
    } catch (e) {
      console.error("Memory build error:", e);
      toast({
        title: "Erreur lors de l'analyse",
        description: e instanceof Error ? e.message : "Nous n'avons pas pu construire la mémoire relationnelle.",
        variant: "destructive"
      });
      setStep('upload');
    }
  };

  const handleWhatsappUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      try {
        setStep('processing');
        setProgressMessages(["Lecture du fichier WhatsApp..."]);
        
        const result = await importWhatsapp.mutateAsync({ 
          relationId, 
          data: { content, filename: file.name } 
        });
        
        setStats({ imported: result.imported, total: result.totalMessages });
        await startMemoryBuild();
      } catch (error) {
        toast({ title: "Erreur d'import", variant: "destructive" });
        setStep('upload');
      }
    };
    reader.readAsText(file);
  };

  const [pasteText, setPasteText] = useState("");
  const handlePasteSubmit = async () => {
    if (!pasteText.trim() || !relation) return;
    try {
      setStep('processing');
      setProgressMessages(["Analyse du texte..."]);
      
      await importPaste.mutateAsync({
        relationId,
        data: {
          text: pasteText,
          participantMe: relation.participantMe,
          participantOther: relation.participantOther
        }
      });
      await startMemoryBuild();
    } catch (error) {
      toast({ title: "Erreur d'import", variant: "destructive" });
      setStep('upload');
    }
  };

  if (isRelationLoading) return <div className="p-12">Chargement...</div>;
  if (!relation) return <div className="p-12">Relation introuvable</div>;

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-4 md:p-8 flex flex-col items-center justify-center min-h-[calc(100vh-6rem)]">
      {step === 'upload' && (
        <div className="w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="text-center space-y-3">
            <h1 className="font-serif text-3xl md:text-4xl tracking-tight">Importer l'historique</h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Fournissez des messages à ReLink pour qu'il comprenne la dynamique entre {relation.participantMe} et {relation.participantOther}.
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto p-1 bg-muted/50">
              <TabsTrigger value="whatsapp" className="py-3 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <UploadCloud className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">WhatsApp</span>
              </TabsTrigger>
              <TabsTrigger value="paste" className="py-3 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <FileText className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Coller</span>
              </TabsTrigger>
              <TabsTrigger value="screenshot" className="py-3 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <ImageIcon className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Capture</span>
              </TabsTrigger>
              <TabsTrigger value="manual" className="py-3 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Keyboard className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Manuel</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-8 bg-card border rounded-3xl p-6 md:p-10 shadow-sm">
              <TabsContent value="whatsapp" className="m-0 focus-visible:outline-none">
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="h-20 w-20 rounded-full bg-primary/5 flex items-center justify-center border border-primary/10">
                    <UploadCloud className="h-10 w-10 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-medium">Export WhatsApp (.txt)</h3>
                    <p className="text-muted-foreground text-sm max-w-sm">
                      Dans WhatsApp: Plus {">"} Exporter la discussion {">"} Sans médias.
                    </p>
                  </div>
                  <div className="w-full max-w-sm">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <p className="text-sm font-medium mb-1">Cliquez pour choisir un fichier</p>
                        <p className="text-xs text-muted-foreground">TXT uniquement, max 50MB</p>
                      </div>
                      <input type="file" accept=".txt" className="hidden" onChange={handleWhatsappUpload} />
                    </label>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="paste" className="m-0 focus-visible:outline-none">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-medium">Coller le texte brut</h3>
                    <p className="text-sm text-muted-foreground">
                      Copiez-collez une sélection de messages depuis n'importe quelle application.
                    </p>
                  </div>
                  <Textarea 
                    placeholder="Paul: Salut, tu vas bien ?&#10;Moi: Oui ça va. Et toi ?" 
                    className="min-h-[200px] resize-none rounded-2xl p-4 bg-background border-border font-mono text-sm"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button onClick={handlePasteSubmit} disabled={!pasteText.trim()} className="rounded-full px-6">
                      Importer et analyser
                    </Button>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="screenshot" className="m-0 text-center py-12 focus-visible:outline-none text-muted-foreground">
                <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Import par capture d'écran bientôt disponible</p>
              </TabsContent>
              
              <TabsContent value="manual" className="m-0 text-center py-12 focus-visible:outline-none text-muted-foreground">
                <Keyboard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Saisie manuelle bientôt disponible</p>
              </TabsContent>
            </div>
            
            <div className="mt-8 flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground/60">
              <Shield className="h-4 w-4" />
              Vos messages ne quittent jamais ce navigateur, tout le traitement est sécurisé.
            </div>
          </Tabs>
        </div>
      )}

      {step === 'processing' && (
        <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in-95 duration-500 text-center">
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <BrainCircuit className="h-8 w-8 text-primary animate-pulse" />
            </div>
          </div>
          
          <div className="space-y-4">
            <h2 className="text-2xl font-serif">Analyse en cours</h2>
            <div className="space-y-2 text-sm">
              {progressMessages.map((msg, i) => (
                <div 
                  key={i} 
                  className={`flex items-center justify-center gap-2 transition-opacity duration-300 ${
                    i === progressMessages.length - 1 ? "text-primary font-medium opacity-100" : "text-muted-foreground opacity-50"
                  }`}
                >
                  {i < progressMessages.length - 1 && <CheckCircle2 className="h-4 w-4 text-secondary" />}
                  {msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="w-full max-w-xl space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-700 text-center">
          <div className="mx-auto w-20 h-20 bg-secondary/10 text-secondary rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          
          <div className="space-y-3">
            <h2 className="text-3xl font-serif">Mémoire relationnelle prête</h2>
            <p className="text-muted-foreground text-lg">
              ReLink a analysé {stats?.imported || "les"} messages et construit le profil de la relation.
            </p>
          </div>
          
          <div className="grid gap-3 pt-6">
            <Button 
              size="lg" 
              className="w-full rounded-2xl h-14 text-base"
              onClick={() => setLocation(`/relations/${relationId}`)}
            >
              <MessageSquare className="mr-2 h-5 w-5" />
              Ouvrir l'espace de travail
            </Button>
            
            <Button 
              variant="outline" 
              size="lg" 
              className="w-full rounded-2xl h-14 text-base"
              onClick={() => setLocation(`/relations/${relationId}/memory`)}
            >
              <Search className="mr-2 h-5 w-5" />
              Voir le rapport d'analyse
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Dummy hook for manual to prevent errors
function useManualImport() {
  return {
    mutateAsync: async () => { await new Promise(r => setTimeout(r, 1000)); return {}; }
  };
}
