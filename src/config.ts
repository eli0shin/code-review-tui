import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OperationResult, ReviewConfig, UpdateBehavior } from './types.ts';

export function getConfigPath(
  environment: { readonly XDG_CONFIG_HOME?: string } = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  },
  homeDirectory: string = homedir()
): string {
  const configHome =
    environment.XDG_CONFIG_HOME || join(homeDirectory, '.config');
  return join(configHome, 'review', 'config.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReviewConfig(value: unknown): value is ReviewConfig {
  if (!isRecord(value)) return false;
  if (value.config === undefined) return true;
  if (!isRecord(value.config)) return false;

  const { updateBehavior, updateCheckIntervalHours } = value.config;
  return (
    (updateBehavior === undefined ||
      updateBehavior === 'auto' ||
      updateBehavior === 'notify' ||
      updateBehavior === 'off') &&
    (updateCheckIntervalHours === undefined ||
      typeof updateCheckIntervalHours === 'number')
  );
}

export async function readConfig(
  configPath: string
): Promise<OperationResult<ReviewConfig>> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) return { success: true, data: {} };

  try {
    const value: unknown = await file.json();
    return isReviewConfig(value)
      ? { success: true, data: value }
      : { success: false, error: 'Invalid config file format' };
  } catch {
    return { success: false, error: 'Failed to parse config file' };
  }
}

export function getUpdateBehavior(config: ReviewConfig): UpdateBehavior {
  return config.config?.updateBehavior ?? 'auto';
}

export function getUpdateCheckInterval(config: ReviewConfig): number {
  return config.config?.updateCheckIntervalHours ?? 24;
}
