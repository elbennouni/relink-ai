import { Link, useLocation } from "wouter";
import { Home, MessageSquare, BrainCircuit, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-background text-foreground md:flex-row">
      <DesktopSidebar />
      <main className="flex-1 w-full pb-16 md:pb-0 relative flex flex-col h-[100dvh] md:h-auto overflow-hidden md:overflow-visible">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}

function DesktopSidebar() {
  const [location] = useLocation();

  const isRelationActive = location.startsWith("/relations/") && location !== "/relations/new";
  const relationIdMatch = location.match(/\/relations\/(\d+)/);
  const relationId = relationIdMatch ? relationIdMatch[1] : null;

  const navItems = [
    { href: "/", label: "ReLink", icon: Home, exact: true },
    ...(isRelationActive && relationId
      ? [
          { href: `/relations/${relationId}`, label: "Conversation", icon: MessageSquare, exact: true },
          { href: `/relations/${relationId}/memory`, label: "Mémoire", icon: BrainCircuit, exact: false },
        ]
      : []),
    { href: "/settings", label: "Paramètres", icon: Settings, exact: false },
  ];

  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-border/50 bg-sidebar/50 p-6 sticky top-0 h-[100dvh]">
      <div className="flex items-center gap-3 mb-12">
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
          <div className="h-3 w-3 rounded-full bg-secondary" />
        </div>
        <span className="font-serif text-xl font-medium tracking-tight">ReLink</span>
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => {
          const isActive = item.exact ? location === item.href : location.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-300",
                isActive
                  ? "bg-primary/5 text-primary"
                  : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
              )}
            >
              <item.icon className={cn("h-4 w-4", isActive ? "text-secondary" : "")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      
      <div className="mt-auto pt-6">
        <p className="text-xs text-muted-foreground/60">
          Un espace sécurisé et chiffré.
        </p>
      </div>
    </aside>
  );
}

function MobileNav() {
  const [location] = useLocation();

  const isRelationActive = location.startsWith("/relations/") && location !== "/relations/new";
  const relationIdMatch = location.match(/\/relations\/(\d+)/);
  const relationId = relationIdMatch ? relationIdMatch[1] : null;

  const navItems = [
    { href: "/", label: "ReLink", icon: Home, exact: true },
    ...(isRelationActive && relationId
      ? [
          { href: `/relations/${relationId}`, label: "Conversation", icon: MessageSquare, exact: true },
          { href: `/relations/${relationId}/memory`, label: "Mémoire", icon: BrainCircuit, exact: false },
        ]
      : []),
    { href: "/settings", label: "Paramètres", icon: Settings, exact: false },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border/50 bg-background/80 backdrop-blur-xl px-2 pb-safe pt-2">
      {navItems.map((item) => {
        const isActive = item.exact ? location === item.href : location.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 p-2 min-w-[4rem]",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <item.icon className={cn("h-5 w-5", isActive ? "text-secondary" : "")} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
