import type { KeyEvent } from '@opentui/core';
import {
  normalizeKeyDescriptor,
  queueActions,
  type EffectiveKeyBindings,
  type QueueAction,
} from '../../configuration/index.ts';

export function stopKey(key: KeyEvent): void {
  key.preventDefault();
  key.stopPropagation();
}

export function queueActionForKey(
  key: KeyEvent,
  keyBindings: EffectiveKeyBindings
): QueueAction | undefined {
  return queueActions.find((action) => matchesAction(key, keyBindings, action));
}

export function matchesAction(
  key: KeyEvent,
  keyBindings: EffectiveKeyBindings,
  action: QueueAction
): boolean {
  return keyBindings[action].includes(keyDescriptor(key));
}

function keyDescriptor(key: KeyEvent): string {
  const eventName = key.name === 'return' ? 'enter' : key.name;
  const name = /^[A-Z]$/.test(eventName) ? eventName.toLowerCase() : eventName;
  const modifiers = [
    key.ctrl ? 'ctrl' : undefined,
    key.meta || key.option ? 'alt' : undefined,
    key.shift &&
    /^(?:[a-z0-9]|up|down|left|right|enter|escape|tab|backspace|delete|home|end|pageup|pagedown|space)$/i.test(
      name
    )
      ? 'shift'
      : undefined,
  ].filter((modifier): modifier is string => modifier !== undefined);
  const descriptor =
    modifiers.length === 0 ? name : `${modifiers.join('+')}+${name}`;
  return normalizeKeyDescriptor(descriptor);
}

export function formatBindings(bindings: readonly string[]): string {
  return bindings.join('/');
}

export function footerText(keyBindings: EffectiveKeyBindings): string {
  const movement = `${keyBindings.selectNext[0]}/${keyBindings.selectPrevious[0]}`;
  return `${movement} move  ${formatBindings(keyBindings.openDetails)} details  ${formatBindings(
    keyBindings.openInBrowser
  )} browser  ${formatBindings(keyBindings.openDiff)} diff  ${formatBindings(
    keyBindings.runReviewCommand
  )} review  ${formatBindings(
    keyBindings.composeReviewSubmission
  )} submit  ${formatBindings(keyBindings.togglePullRequestList)} lists  ${formatBindings(keyBindings.showHelp)} help`;
}
