import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

export function App() {
  return <text>Review Queue</text>;
}

export async function launchApplication(): Promise<void> {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
}
