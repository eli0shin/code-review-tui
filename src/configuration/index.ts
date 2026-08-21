import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { UpdateBehavior } from '../types.ts';

export const queueActions = [
  'selectPrevious',
  'selectNext',
  'openDiff',
  'runReviewCommand',
  'composeReviewSubmission',
  'refresh',
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
  openDiff: ['d', 'enter'],
  runReviewCommand: ['c'],
  composeReviewSubmission: ['s'],
  refresh: ['r'],
  showHelp: ['?'],
  quit: ['q'],
} satisfies EffectiveKeyBindings;

const defaultUpdateConfiguration = {
  updateBehavior: 'auto',
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
  try {
    const value: unknown = JSON.parse(await Bun.file(file).text());
    if (!isRecord(value) || !isRecord(value.config)) {
      return defaultUpdateConfiguration;
    }

    const behavior = value.config.updateBehavior;
    const interval = value.config.updateCheckIntervalHours;
    return {
      updateBehavior: isUpdateBehavior(behavior)
        ? behavior
        : defaultUpdateConfiguration.updateBehavior,
      updateCheckIntervalHours:
        typeof interval === 'number'
          ? interval
          : defaultUpdateConfiguration.updateCheckIntervalHours,
    };
  } catch {
    return defaultUpdateConfiguration;
  }
}

type JsonReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: ConfigurationFailure };

async function readJson(file: string): Promise<JsonReadResult> {
  const input = Bun.file(file);
  if (!(await input.exists())) {
    return failure(
      file,
      undefined,
      'Required configuration file does not exist'
    );
  }

  const text = await readFileText(input, file);
  if (!text.ok) return text;
  return parseJson(text.value, file);
}

type TextReadResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly failure: ConfigurationFailure };

async function readFileText(
  input: Bun.BunFile,
  file: string
): Promise<TextReadResult> {
  try {
    return { ok: true, value: await input.text() };
  } catch {
    return failure(file, undefined, 'Configuration file cannot be read');
  }
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
      openDiff: getEffectiveBindings(effective, 'openDiff'),
      runReviewCommand: getEffectiveBindings(effective, 'runReviewCommand'),
      composeReviewSubmission: getEffectiveBindings(
        effective,
        'composeReviewSubmission'
      ),
      refresh: getEffectiveBindings(effective, 'refresh'),
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

function normalizeKeyDescriptor(descriptor: string): string {
  if (/^[A-Z]$/.test(descriptor)) return `shift+${descriptor.toLowerCase()}`;
  if (descriptor === 'ctrl+h') return 'backspace';
  if (descriptor === 'ctrl+i') return 'tab';
  if (descriptor === 'ctrl+j' || descriptor === 'ctrl+m') return 'enter';
  return descriptor;
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
