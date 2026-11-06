import { Router } from 'express';

interface RouteRegistration {
  router: object;
  path: string;
  route: { methods: Record<string, boolean> };
}

interface Mount {
  parent: object;
  prefix: string;
  child: object;
}

/** `/:id` → `/{id}`, the OpenAPI spelling. */
function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

function join(prefix: string, path: string): string {
  const joined = `${prefix}${path === '/' ? '' : path}`;
  return joined === '' ? '/' : joined;
}

/**
 * Every route the app registers, as "METHOD /openapi/path". Express 5 does not
 * keep paths on its router layers, so they are recorded as they are
 * registered: `Router.prototype.route` (which `router.get()` also uses) and
 * `use` are spied on, calling through, while `build` runs. Methods come from
 * each Route; `.all()` (the 405 handler) is not a method. Mounts are followed
 * from the routers that nobody mounts.
 */
export function inventoryRoutes(build: () => unknown): string[] {
  const routes: RouteRegistration[] = [];
  const mounts: Mount[] = [];
  const prototype = Router.prototype as unknown as {
    route: (path: string) => RouteRegistration['route'];
    use: (...args: unknown[]) => unknown;
  };
  const originalRoute = prototype.route;
  const originalUse = prototype.use;

  const routeSpy = jest
    .spyOn(prototype, 'route')
    .mockImplementation(function record(this: object, path: string) {
      const route = originalRoute.call(this, path);
      routes.push({ router: this, path, route });
      return route;
    });
  const useSpy = jest
    .spyOn(prototype, 'use')
    .mockImplementation(function record(this: object, ...args: unknown[]) {
      const [first, ...rest] = args;
      const prefix = typeof first === 'string' ? first : '';
      const handlers = typeof first === 'string' ? rest : args;
      for (const child of handlers) {
        mounts.push({ parent: this, prefix, child: child as object });
      }
      return originalUse.apply(this, args);
    });

  try {
    build();
  } finally {
    routeSpy.mockRestore();
    useSpy.mockRestore();
  }

  const children = new Set(mounts.map((m) => m.child));
  const parents = new Set([
    ...routes.map((r) => r.router),
    ...mounts.map((m) => m.parent),
  ]);
  const found: string[] = [];
  const walk = (router: object, prefix: string): void => {
    for (const { path, route } of routes.filter((r) => r.router === router)) {
      for (const method of Object.keys(route.methods)) {
        if (method === '_all') continue;
        found.push(
          `${method.toUpperCase()} ${toOpenApiPath(join(prefix, path))}`,
        );
      }
    }
    for (const mount of mounts.filter((m) => m.parent === router)) {
      const childPrefix = join(prefix, mount.prefix);
      walk(mount.child, childPrefix === '/' ? '' : childPrefix);
    }
  };
  for (const root of parents) if (!children.has(root)) walk(root, '');
  return found.sort();
}
