import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { UpdateBehavior } from '../types.ts';

export const queueActions = [
  'selectPrevious',
  'selectNext',
  'openDetails',
  'openDiff',
  'runReviewCommand',
  'composeReviewSubmission',
  'refresh',
  'pagePrevious',
  'pageNext',
  'scrollStart',
  'scrollEnd',
  'showErrors',
  'showHelp',
  'quit',
] as const;

export type QueueAction = (typeof queueActions)[number];
export type EffectiveKeyBindings = Readonly<
  Record<QueueAction, readonly string[]>
>;

export type UpdateConfiguration = {
  readonly updateBehavior: UpdateBehavior;
  readonly updateCheckIntervalHours: number;
};

export type ReviewConfiguration = {
  readonly githubSearch: readonly string[];
  readonly reviewCommand: string;
  readonly keyBindings: EffectiveKeyBindings;
  readonly update: UpdateConfiguration;
};

export type ConfigurationFailure = {
  readonly file: string;
  readonly field?: string;
  readonly problem: string;
};

export type ConfigurationResult =
  | { readonly ok: true; readonly value: ReviewConfiguration }
  | { readonly ok: false; readonly failure: ConfigurationFailure };

export type ConfigurationEnvironment = {
  readonly [name: string]: string | undefined;
  readonly HOME?: string;
  readonly XDG_CONFIG_HOME?: string;
};

const defaultKeyBindings = {
  selectPrevious: ['k', 'up'],
  selectNext: ['j', 'down'],
  openDetails: ['enter'],
  openDiff: ['d'],
  runReviewCommand: ['c'],
  composeReviewSubmission: ['s'],
  refresh: ['r'],
  pagePrevious: ['ctrl+u'],
  pageNext: ['ctrl+d'],
  scrollStart: ['g', 'home'],
  scrollEnd: ['shift+g', 'end'],
  showErrors: ['e'],
  showHelp: ['?'],
  quit: ['q', 'escape'],
} satisfies EffectiveKeyBindings;

const defaultReviewConfigurationDocument = {
  github: { search: 'is:pr review-requested:@me state:open' },
  reviewCommand:
    'pi "review the changes in this pr and report your findings to me: $REVIEW_PR_URL"',
  keyBindings: defaultKeyBindings,
  config: {
    updateBehavior: 'auto',
    updateCheckIntervalHours: 24,
  },
} as const;

const formattedDefaultReviewConfiguration = `${JSON.stringify(defaultReviewConfigurationDocument, null, 2)}\n`;

const defaultUpdateConfiguration = {
  updateBehavior: 'auto',
  updateCheckIntervalHours: 24,
} satisfies UpdateConfiguration;

const disabledUpdateConfiguration = {
  updateBehavior: 'off',
  updateCheckIntervalHours: 24,
} satisfies UpdateConfiguration;

const namedKeys = [
  'up',
  'down',
  'left',
  'right',
  'enter',
  'escape',
  'tab',
  'backspace',
  'delete',
  'home',
  'end',
  'pageup',
  'pagedown',
  'space',
] as const;

const namedKeyPattern = namedKeys.join('|');
const modifiedDescriptorPattern = new RegExp(
  `^(?:ctrl\\+)?(?:alt\\+)?(?:shift\\+)?(?:[a-z0-9]|${namedKeyPattern})$`
);

const shiftedDigitAliases = new Map([
  ['shift+1', '!'],
  ['shift+2', '@'],
  ['shift+3', '#'],
  ['shift+4', '$'],
  ['shift+5', '%'],
  ['shift+6', '^'],
  ['shift+7', '&'],
  ['shift+8', '*'],
  ['shift+9', '('],
  ['shift+0', ')'],
]);

const controlDigitAliases = new Map([
  ['ctrl+2', 'ctrl+space'],
  ['ctrl+shift+2', 'ctrl+space'],
  ['ctrl+3', 'escape'],
  ['ctrl+shift+3', 'escape'],
  ['ctrl+8', 'backspace'],
  ['ctrl+shift+8', 'backspace'],
  ['ctrl+alt+2', 'ctrl+alt+space'],
  ['ctrl+alt+shift+2', 'ctrl+alt+space'],
  ['ctrl+alt+3', 'alt+escape'],
  ['ctrl+alt+shift+3', 'alt+escape'],
  ['ctrl+alt+8', 'alt+backspace'],
  ['ctrl+alt+shift+8', 'alt+backspace'],
]);

export function getReviewConfigPath(
  environment: ConfigurationEnvironment = process.env,
  fallbackHome: string = homedir()
): string {
  const configuredHome = environment.XDG_CONFIG_HOME;
  const home = environment.HOME || fallbackHome;
  const configHome =
    configuredHome !== undefined &&
    configuredHome !== '' &&
    isAbsolute(configuredHome)
      ? configuredHome
      : join(home, '.config');
  return join(configHome, 'review', 'config.json');
}

export async function loadReviewConfiguration(
  environment: ConfigurationEnvironment = process.env
): Promise<ConfigurationResult> {
  const file = getReviewConfigPath(environment);
  const document = await readJson(file);
  if (!document.ok) return document;

  const validated = validateReviewConfiguration(document.value, file);
  if (!validated.ok) return validated;
  return { ok: true, value: validated.value };
}

export async function readUpdateConfiguration(
  environment: ConfigurationEnvironment = process.env
): Promise<UpdateConfiguration> {
  return readUpdateConfigurationFile(getReviewConfigPath(environment));
}

export async function readUpdateConfigurationFile(
  file: string
): Promise<UpdateConfiguration> {
  const input = Bun.file(file);
  if (!(await input.exists())) return defaultUpdateConfiguration;

  try {
    const value: unknown = JSON.parse(await input.text());
    if (!isRecord(value)) return disabledUpdateConfiguration;
    if (value.config === undefined) return defaultUpdateConfiguration;
    if (!isRecord(value.config)) return disabledUpdateConfiguration;

    const behavior = value.config.updateBehavior;
    const interval = value.config.updateCheckIntervalHours;
    if (
      (behavior !== undefined && !isUpdateBehavior(behavior)) ||
      (interval !== undefined && typeof interval !== 'number')
    ) {
      return disabledUpdateConfiguration;
    }

    return {
      updateBehavior: behavior ?? defaultUpdateConfiguration.updateBehavior,
      updateCheckIntervalHours:
        interval ?? defaultUpdateConfiguration.updateCheckIntervalHours,
    };
  } catch {
    return disabledUpdateConfiguration;
  }
}

type JsonReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: ConfigurationFailure };

async function readJson(file: string): Promise<JsonReadResult> {
  try {
    return parseJson(await readFile(file, 'utf8'), file);
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
      ? initializeReviewConfiguration(file)
      : failure(file, undefined, 'Configuration file cannot be read');
  }
}

async function initializeReviewConfiguration(
  file: string
): Promise<JsonReadResult> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, formattedDefaultReviewConfiguration, { flag: 'wx' });
    return { ok: true, value: defaultReviewConfigurationDocument };
  } catch (error) {
    return hasErrorCode(error, 'EEXIST')
      ? readConcurrentReviewConfiguration(file)
      : failure(file, undefined, 'Configuration file cannot be created');
  }
}

async function readConcurrentReviewConfiguration(
  file: string
): Promise<JsonReadResult> {
  try {
    return parseJson(await readFile(file, 'utf8'), file);
  } catch {
    return failure(file, undefined, 'Configuration file cannot be read');
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function parseJson(text: string, file: string): JsonReadResult {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return failure(file, undefined, 'Configuration file is not valid JSON');
  }
}

function validateReviewConfiguration(
  value: unknown,
  file: string
): ConfigurationResult {
  if (!isRecord(value)) {
    return failure(file, undefined, 'Configuration must be an object');
  }

  const topLevelFailure = rejectUnknownFields(value, [
    'github',
    'reviewCommand',
    'keyBindings',
    'config',
  ]);
  if (topLevelFailure !== undefined) {
    return failure(file, topLevelFailure, 'Unknown field');
  }

  if (value.github === undefined) {
    return failure(file, 'github', 'Required field is missing');
  }
  if (!isRecord(value.github)) {
    return failure(file, 'github', 'Value must be an object');
  }
  const githubUnknown = rejectUnknownFields(value.github, ['search']);
  if (githubUnknown !== undefined) {
    return failure(file, `github.${githubUnknown}`, 'Unknown field');
  }
  if (value.github.search === undefined) {
    return failure(file, 'github.search', 'Required field is missing');
  }
  const githubSearch = value.github.search;
  const searchFailure = validateRequiredString(githubSearch);
  if (searchFailure !== undefined) {
    return failure(file, 'github.search', searchFailure);
  }
  if (typeof githubSearch !== 'string') {
    return failure(file, 'github.search', 'Value must be a string');
  }
  const search = tokenizeSearch(githubSearch);
  if (!search.ok) return failure(file, 'github.search', search.problem);

  if (value.reviewCommand === undefined) {
    return failure(file, 'reviewCommand', 'Required field is missing');
  }
  const reviewCommand = value.reviewCommand;
  const commandFailure = validateRequiredString(reviewCommand);
  if (commandFailure !== undefined) {
    return failure(file, 'reviewCommand', commandFailure);
  }
  if (typeof reviewCommand !== 'string') {
    return failure(file, 'reviewCommand', 'Value must be a string');
  }

  const bindings = validateKeyBindings(value.keyBindings, file);
  if (!bindings.ok) return bindings;

  const update = validateUpdateConfiguration(value.config, file);
  if (!update.ok) return update;

  return {
    ok: true,
    value: {
      githubSearch: search.value,
      reviewCommand,
      keyBindings: bindings.value,
      update: update.value,
    },
  };
}

type ValidationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: ConfigurationFailure };

function validateKeyBindings(
  value: unknown,
  file: string
): ValidationResult<EffectiveKeyBindings> {
  if (value !== undefined && !isRecord(value)) {
    return failure(file, 'keyBindings', 'Value must be an object');
  }
  const configured = value ?? {};
  const unknown = rejectUnknownFields(configured, queueActions);
  if (unknown !== undefined) {
    return failure(file, `keyBindings.${unknown}`, 'Unknown field');
  }

  const effective = new Map<QueueAction, readonly string[]>();
  const owners = new Map<string, QueueAction>();
  for (const action of queueActions) {
    const candidate = configured[action] ?? defaultKeyBindings[action];
    const field = `keyBindings.${action}`;
    if (!Array.isArray(candidate)) {
      return failure(file, field, 'Value must be an array');
    }
    if (candidate.length === 0) {
      return failure(
        file,
        field,
        'Binding list must contain at least one descriptor'
      );
    }

    const normalized: string[] = [];
    const actionEvents = new Set<string>();
    for (const descriptor of candidate) {
      if (typeof descriptor !== 'string' || !isKeyDescriptor(descriptor)) {
        return failure(
          file,
          field,
          `Invalid key descriptor: ${String(descriptor)}`
        );
      }
      const event = normalizeKeyDescriptor(descriptor);
      if (actionEvents.has(event)) {
        return failure(
          file,
          field,
          `Descriptors in ${action} resolve to the same terminal key event`
        );
      }
      const owner = owners.get(event);
      if (owner !== undefined) {
        return failure(
          file,
          field,
          `Key collision between ${owner} and ${action}`
        );
      }
      actionEvents.add(event);
      owners.set(event, action);
      normalized.push(event);
    }
    effective.set(action, normalized);
  }

  return {
    ok: true,
    value: {
      selectPrevious: getEffectiveBindings(effective, 'selectPrevious'),
      selectNext: getEffectiveBindings(effective, 'selectNext'),
      openDetails: getEffectiveBindings(effective, 'openDetails'),
      openDiff: getEffectiveBindings(effective, 'openDiff'),
      runReviewCommand: getEffectiveBindings(effective, 'runReviewCommand'),
      composeReviewSubmission: getEffectiveBindings(
        effective,
        'composeReviewSubmission'
      ),
      refresh: getEffectiveBindings(effective, 'refresh'),
      pagePrevious: getEffectiveBindings(effective, 'pagePrevious'),
      pageNext: getEffectiveBindings(effective, 'pageNext'),
      scrollStart: getEffectiveBindings(effective, 'scrollStart'),
      scrollEnd: getEffectiveBindings(effective, 'scrollEnd'),
      showErrors: getEffectiveBindings(effective, 'showErrors'),
      showHelp: getEffectiveBindings(effective, 'showHelp'),
      quit: getEffectiveBindings(effective, 'quit'),
    },
  };
}

function getEffectiveBindings(
  bindings: ReadonlyMap<QueueAction, readonly string[]>,
  action: QueueAction
): readonly string[] {
  const value = bindings.get(action);
  if (value === undefined) {
    throw new Error(`Missing validated bindings for ${action}`);
  }
  return value;
}

function validateUpdateConfiguration(
  value: unknown,
  file: string
): ValidationResult<UpdateConfiguration> {
  if (value === undefined) {
    return { ok: true, value: defaultUpdateConfiguration };
  }
  if (!isRecord(value)) {
    return failure(file, 'config', 'Value must be an object');
  }
  const unknown = rejectUnknownFields(value, [
    'updateBehavior',
    'updateCheckIntervalHours',
  ]);
  if (unknown !== undefined) {
    return failure(file, `config.${unknown}`, 'Unknown field');
  }

  const behavior = value.updateBehavior;
  if (behavior !== undefined && !isUpdateBehavior(behavior)) {
    return failure(
      file,
      'config.updateBehavior',
      'Value must be auto, notify, or off'
    );
  }
  const interval = value.updateCheckIntervalHours;
  if (interval !== undefined && typeof interval !== 'number') {
    return failure(
      file,
      'config.updateCheckIntervalHours',
      'Value must be a number'
    );
  }

  return {
    ok: true,
    value: {
      updateBehavior: behavior ?? defaultUpdateConfiguration.updateBehavior,
      updateCheckIntervalHours:
        interval ?? defaultUpdateConfiguration.updateCheckIntervalHours,
    },
  };
}

function tokenizeSearch(
  input: string
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly problem: string } {
  const tokens: string[] = [];
  let token = '';
  let tokenStarted = false;
  let quote: 'single' | 'double' | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote === undefined && /[ \t\r\n]/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single';
      tokenStarted = true;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double';
      tokenStarted = true;
      continue;
    }
    if (character === '\\' && quote !== 'single') {
      index += 1;
      if (index >= input.length) {
        return {
          ok: false,
          problem: 'Search ends with an incomplete backslash escape',
        };
      }
      token += input[index];
      tokenStarted = true;
      continue;
    }
    token += character;
    tokenStarted = true;
  }

  if (quote !== undefined) {
    return { ok: false, problem: `Search has an unclosed ${quote} quote` };
  }
  if (tokenStarted) tokens.push(token);
  if (!tokens.some((item) => item.length > 0)) {
    return { ok: false, problem: 'Search must produce a nonempty argument' };
  }
  return { ok: true, value: tokens };
}

function isKeyDescriptor(descriptor: string): boolean {
  if (descriptor.length === 1) {
    const code = descriptor.charCodeAt(0);
    return code >= 0x21 && code <= 0x7e;
  }
  return modifiedDescriptorPattern.test(descriptor);
}

export function normalizeKeyDescriptor(descriptor: string): string {
  if (/^[A-Z]$/.test(descriptor)) return `shift+${descriptor.toLowerCase()}`;
  const shiftedDigit = shiftedDigitAliases.get(descriptor);
  if (shiftedDigit !== undefined) return shiftedDigit;
  const controlDigit = controlDigitAliases.get(descriptor);
  if (controlDigit !== undefined) return controlDigit;

  let event = descriptor;
  if (/^ctrl\+shift\+[a-z]$/.test(event)) {
    event = event.replace('ctrl+shift+', 'ctrl+');
  } else if (/^ctrl\+alt\+shift\+[a-z]$/.test(event)) {
    event = event.replace('ctrl+alt+shift+', 'ctrl+alt+');
  }
  if (event.endsWith('shift+space')) {
    event = event.replace('shift+space', 'space');
  }

  if (event === 'ctrl+h') return 'backspace';
  if (event === 'ctrl+i') return 'tab';
  if (event === 'ctrl+m') return 'enter';
  if (event === 'ctrl+alt+h') return 'alt+backspace';
  if (event === 'ctrl+alt+i') return 'alt+tab';
  if (event === 'ctrl+alt+m') return 'alt+enter';
  return event;
}

function validateRequiredString(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'Value must be a string';
  if (!/\S/.test(value)) return 'Value must contain a non-whitespace character';
  return undefined;
}

function isUpdateBehavior(value: unknown): value is UpdateBehavior {
  return value === 'auto' || value === 'notify' || value === 'off';
}

function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[]
): string | undefined {
  const fields = Object.keys(value);
  return fields.find((field) => !allowed.includes(field));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(
  file: string,
  field: string | undefined,
  problem: string
): { readonly ok: false; readonly failure: ConfigurationFailure } {
  return { ok: false, failure: { file, field, problem } };
}
