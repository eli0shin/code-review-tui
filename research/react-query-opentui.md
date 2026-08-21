# TanStack React Query in OpenTUI

TanStack Query classifies runtimes without `window` as server environments by default. Its official `environmentManager` API exists to override that classification for nontraditional runtimes. An interactive OpenTUI process is a mounted, long-lived React client even though it has no browser `window`, so configure it as non-server before mounting queries:

```ts
import { environmentManager } from '@tanstack/react-query';

environmentManager.setIsServer(() => false);
```

After this configuration, use the normal React integration: create a `QueryClient`, mount `QueryClientProvider`, and call `useQuery`. `refetchInterval: 60_000` then uses TanStack Query's observer-owned polling timer. A query function receives an `AbortSignal`; passing it to the external operation lets TanStack Query cancel inactive work during unmount.

OpenTUI does not require a special data-fetching adapter. Its React binding uses normal React components, hooks, context, roots, and cleanup. Renderer destruction unmounts the React root, which removes query observers and permits query cancellation.

## Primary sources

- [TanStack Query `environmentManager`](https://tanstack.com/query/latest/docs/reference/environmentManager) — documents `setIsServer` as the global override for runtimes that are not traditional browser/server environments.
- [TanStack Query polling](https://tanstack.com/query/latest/docs/framework/react/guides/polling) — documents numeric `refetchInterval` and observer-owned polling.
- [OpenTUI React bindings](https://opentui.com/docs/bindings/react/) — documents standard React hooks/context behavior and root unmount during renderer cleanup.
