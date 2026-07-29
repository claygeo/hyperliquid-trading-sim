import type { ReactNode } from 'react';
import {
  Link,
  Redirect,
  Route as WouterRoute,
  Switch,
  useLocation as useWouterLocation,
  type NavigateOptions,
} from 'wouter';
import { useHistoryState } from 'wouter/use-browser-location';

export { Link };

interface RouteProps {
  path?: string;
  element: ReactNode;
}

export function Route({ path, element }: RouteProps) {
  return <WouterRoute path={path}>{element}</WouterRoute>;
}

export const Routes = Switch;

interface NavigateProps extends NavigateOptions {
  to: string;
}

export function Navigate({ to, replace, state }: NavigateProps) {
  return <Redirect to={to} replace={replace} state={state} />;
}

// Router hooks live beside the adapter components so call sites have one stable API.
// eslint-disable-next-line react-refresh/only-export-components
export function useNavigate() {
  const [, navigate] = useWouterLocation();
  return navigate;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLocation<TState = unknown>() {
  const [pathname] = useWouterLocation();
  const state = useHistoryState<TState>();

  return { pathname, state };
}
