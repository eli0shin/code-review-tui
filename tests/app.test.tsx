import { describe, expect, test } from 'bun:test';
import { App } from '../src/app.tsx';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('application shell', () => {
  test('identifies the Review Queue', () => {
    const view: unknown = App();
    expect(isRecord(view)).toBe(true);
    if (!isRecord(view)) return;

    const props = view['props'];
    expect(isRecord(props) ? props['children'] : undefined).toBe(
      'Review Queue'
    );
  });
});
