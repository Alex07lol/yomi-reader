/* ─── Router: simple hash-based SPA routing ─── */

type RouteHandler = (params: Record<string, string>) => void;

interface Route {
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

class Router {
  private routes: Route[] = [];
  private currentHandler: (() => void) | null = null;

  on(pattern: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexStr = pattern.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    });
  }

  navigate(hash: string): void {
    window.location.hash = hash;
  }

  start(): void {
    const handle = () => {
      const hash = window.location.hash.slice(1) || 'library';
      const [path, query = ''] = hash.split('?');
      for (const route of this.routes) {
        const m = path.match(route.pattern);
        if (m) {
          const params: Record<string, string> = {};
          route.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(m[i + 1]);
          });
          const search = new URLSearchParams(query).get('search');
          if (search !== null) params.search = search;
          route.handler(params);
          return;
        }
      }
      // fallback to library
      this.navigate('library');
    };
    window.addEventListener('hashchange', handle);
    this.currentHandler = handle;
    handle();
  }

  stop(): void {
    if (this.currentHandler) {
      window.removeEventListener('hashchange', this.currentHandler);
    }
  }
}

export const router = new Router();
