import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import { AppShell } from '@/components/layout/AppShell';
import Home from '@/pages/Home';
import CreateRelation from '@/pages/CreateRelation';
import ImportFlow from '@/pages/Import';
import Workspace from '@/pages/Workspace';
import Memory from '@/pages/Memory';
import Settings from '@/pages/Settings';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/relations/new" component={CreateRelation} />
      <Route path="/relations/:id/import" component={ImportFlow} />
      <Route path="/relations/:id/memory" component={Memory} />
      <Route path="/relations/:id" component={Workspace} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '')}>
          <AppShell>
            <Router />
          </AppShell>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
