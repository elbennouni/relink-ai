export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6 bg-background">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-5xl mb-4 text-primary">404</h1>
        <h2 className="text-xl font-medium mb-6">Page introuvable</h2>
        <p className="text-muted-foreground mb-8">
          Le chemin que vous cherchez n'existe pas ou a été déplacé.
        </p>
        <a 
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Retour à l'accueil
        </a>
      </div>
    </div>
  );
}
