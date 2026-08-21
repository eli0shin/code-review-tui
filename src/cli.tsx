import { Command } from '@commander-js/extra-typings';
import { version } from '../package.json';
import { launchApplication } from './app.tsx';
import { handleAutoUpdate } from './auto-update.ts';
import {
  getConfigPath,
  getUpdateBehavior,
  getUpdateCheckInterval,
  readConfig,
} from './config.ts';
import { updateCommand, type UpdateDependencies } from './commands/update.ts';
import { getReviewExecutablePath } from './update.ts';
import { runUpdaterWorker } from './updater-worker.ts';

export type CliDependencies = {
  readonly launchApplication?: () => Promise<void>;
  readonly update?: UpdateDependencies;
  readonly executablePath?: string;
  readonly currentVersion?: string;
  readonly updateMessage?: string;
};

export function createProgram({
  launchApplication: start = launchApplication,
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

export async function run(
  argv: string[] = process.argv,
  dependencies: CliDependencies = {}
): Promise<void> {
  const executablePath = getReviewExecutablePath();
  if (argv[2] === '--update-worker') {
    if (executablePath !== undefined) await runUpdaterWorker();
    return;
  }

  const configResult = await readConfig(getConfigPath());
  const config = configResult.success ? configResult.data : {};
  const autoUpdateResult =
    executablePath === undefined
      ? {}
      : await handleAutoUpdate(
          version,
          getUpdateBehavior(config),
          getUpdateCheckInterval(config)
        ).catch(() => ({}));

  await createProgram({
    ...dependencies,
    executablePath: dependencies.executablePath ?? executablePath,
    updateMessage: dependencies.updateMessage ?? autoUpdateResult.message,
  }).parseAsync(argv);
}

function writeLine(stream: NodeJS.WriteStream, message: string): void {
  stream.write(`${message}\n`);
}

if (import.meta.main) await run();
