export default function Settings() {
  return (
    <div className="flex-1 w-full max-w-3xl mx-auto p-6 md:p-12">
      <h1 className="font-serif text-3xl mb-8">Paramètres</h1>
      
      <div className="space-y-8">
        <section className="bg-card border rounded-2xl p-6">
          <h2 className="text-xl font-medium mb-4">Confidentialité & Sécurité</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Vos données sont traitées de manière sécurisée. Nous ne conservons vos messages que pour permettre à l'agent de maintenir le contexte de la conversation.
          </p>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-xl bg-background">
              <div>
                <h3 className="font-medium">Chiffrement local</h3>
                <p className="text-xs text-muted-foreground">Protégez vos analyses avec un mot de passe local.</p>
              </div>
              <button disabled className="text-xs font-medium text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
                Bientôt disponible
              </button>
            </div>
            
            <div className="flex items-center justify-between p-4 border border-destructive/20 rounded-xl bg-destructive/5">
              <div>
                <h3 className="font-medium text-destructive">Supprimer toutes les données</h3>
                <p className="text-xs text-destructive/80">Efface définitivement toutes vos relations et analyses.</p>
              </div>
              <button className="text-xs font-medium bg-destructive text-destructive-foreground px-3 py-1.5 rounded-full">
                Tout effacer
              </button>
            </div>
          </div>
        </section>

        <section className="bg-card border rounded-2xl p-6">
          <h2 className="text-xl font-medium mb-4">Préférences d'analyse</h2>
          <div className="space-y-4">
            <div className="p-4 border rounded-xl bg-background">
              <h3 className="font-medium mb-1">Ton de l'assistant</h3>
              <p className="text-xs text-muted-foreground mb-4">Définissez comment ReLink s'adresse à vous.</p>
              <div className="flex gap-2">
                <span className="px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium border border-primary">Analytique & Neutre</span>
                <span className="px-3 py-1.5 rounded-full text-muted-foreground text-xs font-medium border cursor-pointer hover:bg-muted">Empathique & Doux</span>
                <span className="px-3 py-1.5 rounded-full text-muted-foreground text-xs font-medium border cursor-pointer hover:bg-muted">Direct & Ferme</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
