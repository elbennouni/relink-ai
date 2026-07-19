import { useState } from "react";
import { useListRelations, Relation } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Plus, MessageSquarePlus, Image as ImageIcon, Upload, ChevronRight, Lock, MoreVertical, Pencil, Trash2, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function Home() {
  const { data: relations, isLoading, refetch } = useListRelations();
  const [, setLocation] = useLocation();

  const [editTarget, setEditTarget] = useState<Relation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Relation | null>(null);

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto p-6 md:p-12 space-y-12 overflow-y-auto">
      <header className="space-y-3">
        <h1 className="font-serif text-4xl tracking-tight animate-in slide-in-from-bottom-4 fade-in duration-700">
          Bonjour.
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl animate-in slide-in-from-bottom-4 fade-in duration-700 delay-100 fill-mode-both">
          Cet espace est le vôtre. Prenez le temps de déposer ce qui pèse, d'y voir clair, sans jugement.
        </p>
      </header>

      {/* Main Actions */}
      <section className="animate-in slide-in-from-bottom-4 fade-in duration-700 delay-200 fill-mode-both">
        <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-4">
          Nouvelle analyse
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActionCard title="Importer WhatsApp" description="Analysez l'historique complet d'une relation pour en dégager les schémas." icon={Upload} onClick={() => setLocation('/relations/new')} delay={0} />
          <ActionCard title="Coller un message" description="Obtenez une analyse immédiate d'un message reçu." icon={MessageSquarePlus} onClick={() => setLocation('/relations/new?tab=paste')} delay={100} />
          <ActionCard title="Capture d'écran" description="Extrayez et analysez une conversation depuis une image." icon={ImageIcon} onClick={() => setLocation('/relations/new?tab=screenshot')} delay={200} />
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
              <RelationCard
                key={relation.id}
                relation={relation}
                onEdit={() => setEditTarget(relation)}
                onDelete={() => setDeleteTarget(relation)}
              />
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

      {/* Dialog — Renommer */}
      {editTarget && (
        <RenameDialog
          relation={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { refetch(); setEditTarget(null); }}
        />
      )}

      {/* Dialog — Supprimer */}
      {deleteTarget && (
        <DeleteDialog
          relation={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { refetch(); setDeleteTarget(null); }}
        />
      )}
    </div>
  );
}

// ─── RenameDialog ──────────────────────────────────────────────────────────────

function RenameDialog({ relation, onClose, onSaved }: { relation: Relation; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(relation.name);
  const [contact, setContact] = useState(relation.participantOther ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) { setError("Le nom ne peut pas être vide."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/relations/${relation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), participantOther: contact.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      onSaved();
    } catch {
      setError("Impossible de sauvegarder. Réessaie.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Renommer la relation
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rel-name">Nom de la relation</Label>
            <Input
              id="rel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex : Rupture avec Léa"
              className="rounded-xl"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rel-contact">Prénom / pseudo du contact</Label>
            <Input
              id="rel-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Ex : Léa"
              className="rounded-xl"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving} className="rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── DeleteDialog ──────────────────────────────────────────────────────────────

function DeleteDialog({ relation, onClose, onDeleted }: { relation: Relation; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = relation.name;
  const match = confirm.trim() === expected;

  const handleDelete = async () => {
    if (!match) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/relations/${relation.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Erreur serveur");
      onDeleted();
    } catch {
      setError("Impossible de supprimer. Réessaie.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Supprimer la relation
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-4 text-sm text-destructive leading-relaxed">
            Cette action est <strong>irréversible</strong>. Tous les messages, l'analyse et la mémoire associés à{" "}
            <strong>« {relation.name} »</strong> seront définitivement supprimés.
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-name">
              Tape <span className="font-mono font-semibold text-foreground">« {expected} »</span> pour confirmer
            </Label>
            <Input
              id="confirm-name"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={expected}
              className={cn("rounded-xl", match && "border-destructive focus-visible:ring-destructive/30")}
              onKeyDown={(e) => e.key === "Enter" && match && handleDelete()}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={deleting}>Annuler</Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!match || deleting}
            className="rounded-xl"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Supprimer définitivement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ActionCard ────────────────────────────────────────────────────────────────

function ActionCard({ title, description, icon: Icon, onClick, delay }: {
  title: string; description: string; icon: any; onClick: () => void; delay: number;
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

// ─── RelationCard ──────────────────────────────────────────────────────────────

function RelationCard({ relation, onEdit, onDelete }: {
  relation: Relation;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border bg-card hover:border-primary/20 transition-all hover:shadow-md">
      {/* Zone cliquable principale */}
      <Link href={`/relations/${relation.id}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-serif text-xl">{relation.name}</h3>
          {relation.status === "active" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary/10 text-secondary-foreground border border-secondary/20">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
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
      </Link>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Link href={`/relations/${relation.id}`} className="flex items-center text-sm font-medium text-primary opacity-80 group-hover:opacity-100 transition-opacity">
          Continuer
          <ChevronRight className="ml-1 h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
        </Link>

        {/* Menu ⋮ */}
        <div className="relative">
          <button
            onClick={(e) => { e.preventDefault(); setMenuOpen((o) => !o); }}
            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Options"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <>
              {/* Overlay pour fermer */}
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-30 w-44 rounded-xl border bg-popover shadow-lg overflow-hidden py-1">
                <button
                  onClick={(e) => { e.preventDefault(); setMenuOpen(false); onEdit(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                  Renommer
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); setMenuOpen(false); onDelete(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Supprimer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
