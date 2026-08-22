import { describe, expect, jest, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { runReviewRuntime } from '../src/runtime.ts';

class RuntimeInput extends EventEmitter {
  pause = jest.fn(() => this);
}

class RuntimeSignals extends EventEmitter {}

function runtimeFixture() {
  const order: string[] = [];
  const input = new RuntimeInput();
  input.pause.mockImplementation(() => {
    order.push('stop input');
    return input;
  });
  const signals = new RuntimeSignals();
  const renderer = {
    stdin: input,
    destroy: jest.fn(() => order.push('destroy')),
  };
  let quit: (() => void) | undefined;
  const mounted = {
    unmount: jest.fn(() => order.push('unmount')),
  };
  const mount = jest.fn((onQuit: () => void) => {
    order.push('mount');
    quit = onQuit;
    return mounted;
  });
  const run = runReviewRuntime(renderer, mount, signals);
  return {
    input,
    signals,
    renderer,
    mounted,
    mount,
    order,
    run,
    requestQuit() {
      if (quit === undefined) throw new Error('Review page did not mount');
      quit();
    },
  };
}

describe('Review runtime lifecycle', () => {
  test('quit stops input, unmounts the page, and destroys the renderer', async () => {
    const runtime = runtimeFixture();

    runtime.requestQuit();
    await runtime.run;

    expect(runtime.input.pause).toHaveBeenCalledTimes(1);
    expect(runtime.mounted.unmount).toHaveBeenCalledTimes(1);
    expect(runtime.renderer.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.order).toEqual([
      'mount',
      'stop input',
      'unmount',
      'destroy',
    ]);
  });

  test('end-of-input exits with the same cleanup', async () => {
    const runtime = runtimeFixture();

    runtime.input.emit('end');
    await runtime.run;

    expect(runtime.input.pause).toHaveBeenCalledTimes(1);
    expect(runtime.order).toEqual([
      'mount',
      'stop input',
      'unmount',
      'destroy',
    ]);
  });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
    test(`${signal} exits with the same cleanup`, async () => {
      const runtime = runtimeFixture();

      runtime.signals.emit(signal);
      await runtime.run;

      expect(runtime.input.pause).toHaveBeenCalledTimes(1);
      expect(runtime.order).toEqual([
        'mount',
        'stop input',
        'unmount',
        'destroy',
      ]);
    });
  }

  test('a mount failure still stops input and destroys the renderer', async () => {
    const input = new RuntimeInput();
    const signals = new RuntimeSignals();
    const renderer = { stdin: input, destroy: jest.fn() };

    await expect(
      runReviewRuntime(
        renderer,
        () => {
          throw new Error('page did not mount');
        },
        signals
      )
    ).rejects.toThrow('page did not mount');
    expect(input.pause).toHaveBeenCalledTimes(1);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });
});
