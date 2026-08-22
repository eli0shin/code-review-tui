import { Command } from '@commander-js/extra-typings';
import { version } from '../package.json';
import { launchApplication } from './app.tsx';
import { handleAutoUpdate } from './auto-update.ts';
import {
  getReviewConfigPath,
  loadReviewConfiguration,
  readUpdateConfigurationFile,
  type ConfigurationFailure,
  type ReviewConfiguration,
} from './configuration/index.ts';
import { updateCommand, type UpdateDependencies } from './commands/update.ts';
import { getReviewExecutablePath } from './update.ts';
import { runUpdaterWorker } from './updater-worker.ts';

export type CliDependencies = {
  readonly launchApplication?: () => Promise<void>;
  readonly update?: UpdateDependencies;
  readonly executablePath?: string;
  readonly currentVersion?: string;
  readonly updateMessage?: string;
  readonly exitProcess?: (code: number) => void;
};

export function createProgram({
  launchApplication: start = launchConfiguredApplication,
  update,
  executablePath = getReviewExecutablePath(),
  currentVersion = version,
  updateMessage,
}: CliDependencies = {}) {
  let pendingUpdateMessage = updateMessage;
  const program = new Command()
    .name('review')
    .description('Review GitHub pull requests from the terminal')
    .version(currentVersion)
    .action(start);

  program
    .command('update')
    .description('update Review to the latest version')
    .action(async () => {
      const result = await updateCommand(
        currentVersion,
        executablePath,
        update
      );
      for (const message of result.messages) writeLine(process.stdout, message);
      if (result.outcome.ok) {
        pendingUpdateMessage = undefined;
      } else {
        writeLine(process.stderr, result.outcome.failure.message);
        process.exitCode = 1;
      }
    });

  program.hook('postAction', () => {
    if (pendingUpdateMessage !== undefined) {
      writeLine(process.stderr, pendingUpdateMessage);
    }
  });

  return program;
}

type UpdateConfig = {
  readonly behavior: 'auto' | 'notify' | 'off';
  readonly checkIntervalHours: number;
};

export async function getUpdateConfigFromFile(
  configPath: string = getReviewConfigPath()
): Promise<UpdateConfig> {
  const config = await readUpdateConfigurationFile(configPath);
  return {
    behavior: config.updateBehavior,
    checkIntervalHours: config.updateCheckIntervalHours,
  };
}

export async function run(
  argv: string[] = process.argv,
  dependencies: CliDependencies = {}
): Promise<void> {
  const executablePath = getReviewExecutablePath();
  const command = argv.at(2);
  if (command === '--update-worker') {
    if (executablePath !== undefined) await runUpdaterWorker();
    return;
  }

  const startsReview = command === undefined || command === '--';
  const reviewConfiguration = startsReview
    ? await loadRequiredReviewConfiguration()
    : undefined;
  const updateConfig =
    reviewConfiguration === undefined
      ? await getUpdateConfigFromFile()
      : {
          behavior: reviewConfiguration.update.updateBehavior,
          checkIntervalHours:
            reviewConfiguration.update.updateCheckIntervalHours,
        };
  const autoUpdateResult =
    executablePath === undefined
      ? {}
      : await handleAutoUpdate(
          version,
          updateConfig.behavior,
          updateConfig.checkIntervalHours
        ).catch(() => ({}));
  const start =
    dependencies.launchApplication ??
    (reviewConfiguration === undefined
      ? undefined
      : () => launchApplication(reviewConfiguration));

  await createProgram({
    ...dependencies,
    launchApplication: start,
    executablePath: dependencies.executablePath ?? executablePath,
    updateMessage: dependencies.updateMessage ?? autoUpdateResult.message,
  }).parseAsync(argv);
  if (startsReview) (dependencies.exitProcess ?? process.exit)(0);
}

async function launchConfiguredApplication(): Promise<void> {
  await launchApplication(await loadRequiredReviewConfiguration());
}

async function loadRequiredReviewConfiguration(): Promise<ReviewConfiguration> {
  const configuration = await loadReviewConfiguration();
  if (!configuration.ok) {
    throw new Error(configurationFailureMessage(configuration.failure));
  }
  return configuration.value;
}

function configurationFailureMessage(failure: ConfigurationFailure): string {
  const field = failure.field === undefined ? '' : ` field ${failure.field}`;
  return `Invalid Review configuration at ${failure.file}${field}: ${failure.problem}.`;
}

function writeLine(stream: NodeJS.WriteStream, message: string): void {
  stream.write(`${message}\n`);
}

if (import.meta.main) {
  try {
    await run();
  } catch (error) {
    writeLine(process.stderr, `review: ${describeError(error)}`);
    process.exitCode = 1;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
