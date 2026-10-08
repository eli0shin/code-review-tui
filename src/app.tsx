import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import type { ReviewConfiguration } from './configuration/index.ts';
import { createGitHubCliAdapter } from './github/cli-adapter.ts';
import { resolveCurrentRepository } from './github/current-repository.ts';
import { runReviewRuntime } from './runtime.ts';
import { createHerdrCliAdapter } from './tools/herdr-adapter.ts';
import { ReviewQueuePage } from './presentation/review-queue/page.tsx';

export { ReviewQueuePage };

export function App() {
  return <text>Review Queue</text>;
}

export async function launchApplication(
  configuration: ReviewConfiguration
): Promise<void> {
  const {
    githubSearch,
    githubSearchText,
    refreshIntervalMinutes,
    pageSize,
    reviewCommand,
    diffCommand,
    keyBindings,
  } = configuration;
  const workingDirectory = process.cwd();
  const herdr = createHerdrCliAdapter({
    reviewCommand,
    diffCommand,
    workingDirectory,
    environment: process.env,
  });
  const github = createGitHubCliAdapter(githubSearch);
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
  });
  await runReviewRuntime(renderer, (onQuit) => {
    const root = createRoot(renderer);
    root.render(
      <ReviewQueuePage
        github={github}
        herdr={herdr}
        keyBindings={keyBindings}
        refreshIntervalMinutes={refreshIntervalMinutes}
        githubSearchText={githubSearchText}
        pageSize={pageSize}
        loadCurrentRepository={(signal) =>
          resolveCurrentRepository(workingDirectory, signal)
        }
        onQuit={onQuit}
      />
    );
    return root;
  });
}
