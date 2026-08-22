import type { CliRenderer } from '@opentui/core';
import type { Root } from '@opentui/react';

const terminationSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

type RuntimeInput = {
  once(event: 'end', listener: () => void): unknown;
  removeListener(event: 'end', listener: () => void): unknown;
  pause(): unknown;
};
type RuntimeRenderer = Pick<CliRenderer, 'destroy'> & {
  readonly stdin: RuntimeInput;
};
type RuntimeSignals = {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
};
type MountReviewPage = (onQuit: () => void) => Pick<Root, 'unmount'>;

export async function runReviewRuntime(
  renderer: RuntimeRenderer,
  mount: MountReviewPage,
  signals: RuntimeSignals = process
): Promise<void> {
  let finish = () => undefined;
  const exitRequested = new Promise<void>((resolve) => {
    let requested = false;
    finish = () => {
      if (requested) return;
      requested = true;
      resolve();
    };
  });
  const onEnd = finish;
  renderer.stdin.once('end', onEnd);
  for (const signal of terminationSignals) signals.once(signal, finish);

  const cleanup = (page?: Pick<Root, 'unmount'>): void => {
    renderer.stdin.removeListener('end', onEnd);
    for (const signal of terminationSignals) {
      signals.removeListener(signal, finish);
    }
    renderer.stdin.pause();
    try {
      page?.unmount();
    } finally {
      renderer.destroy();
    }
  };
  const page = mountPage(mount, finish, cleanup);
  await exitRequested;
  cleanup(page);
}

function mountPage(
  mount: MountReviewPage,
  onQuit: () => void,
  cleanup: () => void
): Pick<Root, 'unmount'> {
  try {
    return mount(onQuit);
  } catch (error) {
    cleanup();
    throw error;
  }
}
