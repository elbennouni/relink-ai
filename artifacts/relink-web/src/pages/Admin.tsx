import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import {
  Users, BarChart2, Tag, Search, ChevronLeft, ChevronRight,
  Shield, Zap, CheckCircle2, XCircle, Trash2, Crown, RefreshCw, FlaskConical
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type Tab = "stats" | "users" | "offer";

interface Stats {
  totalUsers: number;
  premiumUsers: number;
  adminUsers: number;
  totalRelations: number;
  totalMessages: number;
  scheduledPending: number;
}

interface AdminUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string;
  createdAt: number;
  lastSignInAt?: number | null;
  isPremium: boolean;
  isAdmin: boolean;
  noLimit: boolean;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 flex flex-col gap-3">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", color)}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default function Admin() {
  const { user } = useUser();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [offer, setOffer] = useState<any>(null);

  const isAdmin = !!(user?.publicMetadata as any)?.isAdmin;
  const myIsPremium = !!(user?.publicMetadata as any)?.isPremium;
  if (!isAdmin) return <Redirect to="/" />;

  const toggleMyPremium = async () => {
    if (!user) return;
    try {
      const r = await fetch(`/api/admin/users/${user.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPremium: !myIsPremium }),
      });
      if (r.ok) {
        await user.reload();
        toast({ title: myIsPremium ? "Premium désactivé (mode test)" : "Premium activé" });
      }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/stats");
      if (r.ok) setStats(await r.json());
    } catch {}
  }, []);

  const loadUsers = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/users?page=${p}`);
      if (r.ok) {
        const d = await r.json();
        setUsers(d.users);
        setTotalUsers(d.total);
      }
    } catch {} finally { setLoading(false); }
  }, []);

  const loadOffer = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/offer");
      if (r.ok) setOffer(await r.json());
    } catch {}
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === "users") loadUsers(page); }, [tab, page, loadUsers]);
  useEffect(() => { if (tab === "offer") loadOffer(); }, [tab, loadOffer]);

  const toggleMeta = async (userId: string, field: "isPremium" | "isAdmin" | "noLimit", value: boolean) => {
    try {
      const r = await fetch(`/api/admin/users/${userId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (r.ok) {
        setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, [field]: value } : u));
        toast({ title: "Mis à jour" });
        loadStats();
      }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const deleteUser = async (u: AdminUser) => {
    if (!confirm(`Supprimer ${u.email} ? Cette action est irréversible.`)) return;
    try {
      const r = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      if (r.ok) {
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
        toast({ title: "Utilisateur supprimé" });
        loadStats();
      }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const filtered = search
    ? users.filter((u) =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(search.toLowerCase())
      )
    : users;

  const totalPages = Math.ceil(totalUsers / 50);

  const tabs = [
    { id: "stats" as Tab, label: "Stats", icon: BarChart2 },
    { id: "users" as Tab, label: "Utilisateurs", icon: Users },
    { id: "offer" as Tab, label: "Offre", icon: Tag },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
            <Shield className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Admin ReLink</h1>
            <p className="text-xs text-muted-foreground">Panneau de contrôle</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMyPremium}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              myIsPremium
                ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
            )}
            title="Activer/désactiver le premium sur ton compte (test)"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            {myIsPremium ? "Premium ON" : "Premium OFF"}
          </button>
          <button
            onClick={() => { loadStats(); if (tab === "users") loadUsers(page); }}
            className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 pb-0 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* ── STATS ── */}
        {tab === "stats" && (
          <div className="space-y-6">
            {stats ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <StatCard label="Utilisateurs total" value={stats.totalUsers} icon={Users} color="bg-blue-500" />
                  <StatCard label="Comptes Premium" value={stats.premiumUsers} icon={Crown} color="bg-amber-500" />
                  <StatCard label="Admins" value={stats.adminUsers} icon={Shield} color="bg-purple-500" />
                  <StatCard label="Relations créées" value={stats.totalRelations} icon={Zap} color="bg-emerald-500" />
                  <StatCard label="Messages analysés" value={stats.totalMessages.toLocaleString("fr-FR")} icon={BarChart2} color="bg-sky-500" />
                  <StatCard label="Messages programmés" value={stats.scheduledPending} icon={RefreshCw} color="bg-rose-500" />
                </div>
                <div className="rounded-2xl border border-border/60 bg-card p-5">
                  <h3 className="text-sm font-semibold mb-3">Taux de conversion</h3>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all"
                        style={{ width: stats.totalUsers ? `${Math.min(100, (stats.premiumUsers / stats.totalUsers) * 100)}%` : "0%" }}
                      />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {stats.totalUsers ? ((stats.premiumUsers / stats.totalUsers) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{stats.premiumUsers} premium sur {stats.totalUsers} inscrits</p>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Chargement…</div>
            )}
          </div>
        )}

        {/* ── USERS ── */}
        {tab === "users" && (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par email ou nom…"
                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Chargement…</div>
            ) : (
              <>
                <div className="rounded-2xl border border-border/60 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b border-border/60">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Utilisateur</th>
                        <th className="text-center px-3 py-3 font-medium text-muted-foreground">Premium</th>
                        <th className="text-center px-3 py-3 font-medium text-muted-foreground">Admin</th>
                        <th className="text-center px-3 py-3 font-medium text-muted-foreground">Sans limite</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Inscrit le</th>
                        <th className="px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {filtered.map((u) => (
                        <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {u.imageUrl ? (
                                <img src={u.imageUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-border/40" />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                                  {(u.email[0] ?? "?").toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium truncate max-w-[180px]">{u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.email}</p>
                                {u.firstName && <p className="text-xs text-muted-foreground truncate max-w-[180px]">{u.email}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={() => toggleMeta(u.id, "isPremium", !u.isPremium)}
                              className={cn("inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors", u.isPremium ? "bg-amber-100 text-amber-600 hover:bg-amber-200" : "bg-muted text-muted-foreground hover:bg-muted/80")}
                              title={u.isPremium ? "Retirer Premium" : "Activer Premium"}
                            >
                              {u.isPremium ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={() => toggleMeta(u.id, "isAdmin", !u.isAdmin)}
                              className={cn("inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors", u.isAdmin ? "bg-purple-100 text-purple-600 hover:bg-purple-200" : "bg-muted text-muted-foreground hover:bg-muted/80")}
                              title={u.isAdmin ? "Retirer Admin" : "Donner Admin"}
                            >
                              {u.isAdmin ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={() => toggleMeta(u.id, "noLimit", !u.noLimit)}
                              className={cn("inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors", u.noLimit ? "bg-emerald-100 text-emerald-600 hover:bg-emerald-200" : "bg-muted text-muted-foreground hover:bg-muted/80")}
                              title={u.noLimit ? "Retirer sans limite" : "Activer sans limite"}
                            >
                              {u.noLimit ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                          </td>
                          <td className="px-3 py-3">
                            <button
                              onClick={() => deleteUser(u)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-500 transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Aucun utilisateur trouvé</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && !search && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{totalUsers} utilisateurs au total</p>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted/50 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
                      <button
                        disabled={page === totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted/50 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── OFFER ── */}
        {tab === "offer" && (
          <div className="space-y-4 max-w-lg">
            {offer ? (
              <>
                <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
                  <h3 className="text-sm font-semibold">Offre actuelle</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Prix mensuel</p>
                      <p className="text-xl font-bold">{offer.monthlyPrice} {offer.currency}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Prix annuel</p>
                      <p className="text-xl font-bold">{offer.yearlyPrice} {offer.currency}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Label de lancement</p>
                    <p className="text-sm font-medium">{offer.earlyBirdLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Tagline</p>
                    <p className="text-sm">{offer.tagline}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
                  <p className="text-xs text-amber-700 font-medium mb-1">💡 Comment modifier</p>
                  <p className="text-xs text-amber-600">Les prix sont configurés via les variables d'environnement du serveur :</p>
                  <div className="mt-2 font-mono text-xs text-amber-800 space-y-1">
                    <div>OFFER_MONTHLY_PRICE=19</div>
                    <div>OFFER_YEARLY_PRICE=149</div>
                    <div>OFFER_CURRENCY=EUR</div>
                    <div>OFFER_TAGLINE=…</div>
                    <div>OFFER_EARLY_BIRD_LABEL=…</div>
                  </div>
                  <p className="text-xs text-amber-600 mt-2">Une fois un provider de paiement intégré (Stripe ou Whop), la gestion se fera directement depuis ce panneau.</p>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Chargement…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
