import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation } from "wouter";
import { useCreateRelation } from "@workspace/api-client-react";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User, Users } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(1, "Donnez un nom à cette relation"),
  participantMe: z.string().min(1, "Entrez votre prénom ou surnom"),
  participantOther: z.string().min(1, "Entrez le prénom ou surnom de l'autre personne"),
});

export default function CreateRelation() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createRelation = useCreateRelation();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      participantMe: "",
      participantOther: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createRelation.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          // Parse out ?tab=xxx if any from the URL to forward it
          const searchParams = new URLSearchParams(window.location.search);
          const tab = searchParams.get('tab');
          
          if (tab) {
            setLocation(`/relations/${data.id}/import?tab=${tab}`);
          } else {
            setLocation(`/relations/${data.id}/import`);
          }
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Une erreur est survenue",
            description: "Impossible de créer la relation. Veuillez réessayer.",
          });
        },
      }
    );
  }

  return (
    <div className="flex-1 w-full max-w-2xl mx-auto p-6 md:p-12 overflow-y-auto">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
        <ArrowLeft className="h-4 w-4" />
        Retour à l'accueil
      </Link>

      <div className="space-y-2 mb-10">
        <h1 className="font-serif text-3xl md:text-4xl tracking-tight">
          Nouvelle relation
        </h1>
        <p className="text-muted-foreground text-lg">
          Définissez les bases de cette analyse. Ces informations aideront ReLink à comprendre la dynamique.
        </p>
      </div>

      <div className="bg-card rounded-3xl p-6 md:p-8 border shadow-sm">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Nom de la relation
                  </FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="ex: Paul, Mon ex, Notre histoire..." 
                      className="text-lg px-4 py-6 rounded-xl bg-background border-border" 
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    Un identifiant pour retrouver cette analyse plus tard.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="participantMe"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <User className="h-4 w-4 text-secondary" />
                      Votre prénom
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Vous" className="rounded-xl" {...field} />
                    </FormControl>
                    <FormDescription>
                      Comment vous apparaissez dans les messages.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="participantOther"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      L'autre personne
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="L'autre" className="rounded-xl" {...field} />
                    </FormControl>
                    <FormDescription>
                      Le prénom ou numéro de l'autre personne.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="pt-6 border-t flex justify-end">
              <Button 
                type="submit" 
                size="lg" 
                disabled={createRelation.isPending}
                className="rounded-full px-8"
              >
                {createRelation.isPending ? "Création..." : "Continuer vers l'importation"}
                {!createRelation.isPending && <ArrowLeft className="h-4 w-4 ml-2 rotate-180" />}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
