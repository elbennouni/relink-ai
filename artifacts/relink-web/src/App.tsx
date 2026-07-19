import { useEffect, useRef } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import NoContact from './pages/NoContact';
import WhatsAppConfig from './pages/WhatsAppConfig';
import { AppShell } from '@/components/layout/AppShell';
import Home from '@/pages/Home';
import Landing from '@/pages/Landing';
import CreateRelation from '@/pages/CreateRelation';
import ImportFlow from '@/pages/Import';
import Workspace from '@/pages/Workspace';
import Memory from '@/pages/Memory';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

// REQUIRED — copy verbatim
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev (intentional), auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(24 9.8% 10%)',
    colorForeground: 'hsl(24 9.8% 10%)',
    colorMutedForeground: 'hsl(25 5.3% 44.7%)',
    colorDanger: 'hsl(0 84.2% 60.2%)',
    colorBackground: 'hsl(0 0% 100%)',
    colorInput: 'hsl(60 4.8% 95.9%)',
    colorInputForeground: 'hsl(24 9.8% 10%)',
    colorNeutral: 'hsl(20 5.9% 90%)',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'font-serif text-foreground',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButtonText: 'text-foreground',
    formFieldLabel: 'text-foreground text-sm font-medium',
    footerActionLink: 'text-primary font-medium',
    footerActionText: 'text-muted-foreground',
    dividerText: 'text-muted-foreground',
    identityPreviewEditButton: 'text-primary',
    formFieldSuccessText: 'text-green-600',
    alertText: 'text-foreground',
    logoBox: 'flex justify-center mb-2',
    logoImage: 'h-10 w-10',
    socialButtonsBlockButton: 'border border-border rounded-xl',
    formButtonPrimary: 'bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl',
    formFieldInput: 'rounded-xl border-border bg-input text-foreground',
    footerAction: 'border-t border-border/40',
    dividerLine: 'bg-border',
    alert: 'rounded-xl',
    otpCodeFieldInput: 'rounded-xl border-border',
    formFieldRow: '',
    main: '',
  },
};

/** Invalidates QueryClient cache when the signed-in user changes. */
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

/** / — shows Landing for signed-out, app for signed-in */
function HomeOrLanding() {
  return (
    <>
      <Show when="signed-in">
        <Home />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

/** Wrap a page — redirect to / if signed-out */
function Protected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function AppRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Bienvenue sur ReLink',
            subtitle: 'Connectez-vous pour accéder à votre espace',
          },
        },
        signUp: {
          start: {
            title: 'Créer votre compte',
            subtitle: 'Votre espace privé et sécurisé',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AppShell>
            <Switch>
              {/* Public routes */}
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/" component={HomeOrLanding} />

              {/* Protected routes */}
              <Route path="/relations/new">
                <Protected><CreateRelation /></Protected>
              </Route>
              <Route path="/relations/:id/import">
                <Protected><ImportFlow /></Protected>
              </Route>
              <Route path="/relations/:id/memory">
                <Protected><Memory /></Protected>
              </Route>
              <Route path="/relations/:id/no-contact">
                <Protected><NoContact /></Protected>
              </Route>
              <Route path="/relations/:id/whatsapp">
                <Protected><WhatsAppConfig /></Protected>
              </Route>
              <Route path="/relations/:id">
                <Protected><Workspace /></Protected>
              </Route>
              <Route path="/settings">
                <Protected><Settings /></Protected>
              </Route>

              <Route component={NotFound} />
            </Switch>
          </AppShell>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}

export default App;
