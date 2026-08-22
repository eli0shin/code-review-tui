import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { version } from '../package.json';

const executable = resolve('review');
let directory: string;
let environment: NodeJS.ProcessEnv;
let ghRecord: string;
let herdrRecord: string;

beforeAll(async () => {
  const build = Bun.spawn(['bun', 'run', 'build'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [buildExit, buildStderr] = await Promise.all([
    build.exited,
    new Response(build.stderr).text(),
  ]);
  if (buildExit !== 0) throw new Error(`Native build failed: ${buildStderr}`);

  directory = await mkdtemp(join(tmpdir(), 'review-native-smoke-'));
  const bin = join(directory, 'bin');
  const configDirectory = join(directory, 'config', 'review');
  const stateDirectory = join(directory, 'state');
  await mkdir(bin, { recursive: true });
  await mkdir(configDirectory, { recursive: true });
  await mkdir(stateDirectory, { recursive: true });
  ghRecord = join(directory, 'gh-calls');
  herdrRecord = join(directory, 'herdr-calls');
  await writeExecutable(
    join(bin, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$FAKE_GH_RECORD"\nif [ -n "$FAKE_GH_HANG" ]; then\n  printf '%s' "$$" > "$FAKE_GH_HANG"\n  trap '' TERM\n  while :; do sleep 1; done\nfi\nprintf '[]'\n`
  );
  await writeExecutable(
    join(bin, 'herdr'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$FAKE_HERDR_RECORD"\nexit 99\n`
  );
  await Bun.write(
    join(configDirectory, 'config.json'),
    JSON.stringify({
      github: { search: 'review-requested:@me state:open' },
      reviewCommand: 'printf review',
      config: { updateBehavior: 'off' },
    })
  );
  await Bun.write(
    join(stateDirectory, 'review-update-state'),
    JSON.stringify({ lastCheckedAt: Date.now() })
  );
  environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_STATE_HOME: stateDirectory,
    HERDR_ENV: '1',
    HERDR_WORKSPACE_ID: 'workspace-1',
    HERDR_TAB_ID: 'queue-tab-1',
    FAKE_GH_RECORD: ghRecord,
    FAKE_HERDR_RECORD: herdrRecord,
  };
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('native review executable', () => {
  test('loads configuration, renders the page, starts the Review Queue query, and quits cleanly', async () => {
    const review = Bun.spawn(
      ['script', '--quiet', '--return', '--command', executable, '/dev/null'],
      {
        env: environment,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const stdout = new Response(review.stdout).text();
    const stderr = new Response(review.stderr).text();

    await waitForFile(ghRecord);
    await Bun.sleep(100);
    review.stdin.write('q');
    review.stdin.end();

    expect(await exitWithin(review)).toBe(0);
    expect(stripTerminalControls(await stdout)).toContain('No reviews waiting');
    expect(await stderr).toBe('');
    expect(await Bun.file(ghRecord).text()).toContain(
      'search prs --json number,title,author,isDraft,state,createdAt,updatedAt,url,repository,labels,commentsCount --limit 1000 -- review-requested:@me state:open'
    );
    expect(await Bun.file(herdrRecord).exists()).toBe(false);
  });

  test('silently creates complete defaults and continues first startup', async () => {
    const firstRunConfigHome = join(directory, 'first-run-config');
    const firstRunGhRecord = join(directory, 'first-run-gh-calls');
    const review = Bun.spawn(
      ['script', '--quiet', '--return', '--command', executable, '/dev/null'],
      {
        env: {
          ...environment,
          XDG_CONFIG_HOME: firstRunConfigHome,
          FAKE_GH_RECORD: firstRunGhRecord,
        },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const stdout = new Response(review.stdout).text();
    const stderr = new Response(review.stderr).text();

    await waitForFile(firstRunGhRecord);
    await Bun.sleep(100);
    review.stdin.write('q');
    review.stdin.end();

    expect(await exitWithin(review)).toBe(0);
    expect(stripTerminalControls(await stdout)).toContain('No reviews waiting');
    expect(await stderr).toBe('');
    expect(
      JSON.parse(
        await Bun.file(join(firstRunConfigHome, 'review', 'config.json')).text()
      )
    ).toEqual({
      github: { search: 'is:pr review-requested:@me state:open' },
      reviewCommand:
        'pi "review the changes in this pr and report your findings to me: $REVIEW_PR_URL"',
      keyBindings: {
        selectPrevious: ['k', 'up'],
        selectNext: ['j', 'down'],
        openDiff: ['d', 'enter'],
        runReviewCommand: ['c'],
        composeReviewSubmission: ['s'],
        refresh: ['r'],
        showHelp: ['?'],
        quit: ['q'],
      },
      config: { updateBehavior: 'auto', updateCheckIntervalHours: 24 },
    });
  });

  test('does not create configuration for a command that does not need it', async () => {
    const configHome = join(directory, 'version-config');
    const review = Bun.spawn([executable, '--version'], {
      env: { ...environment, XDG_CONFIG_HOME: configHome },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      review.exited,
      new Response(review.stdout).text(),
      new Response(review.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(version);
    expect(stderr).toBe('');
    expect(
      await Bun.file(join(configHome, 'review', 'config.json')).exists()
    ).toBe(false);
  });

  test('exits immediately when the active GitHub CLI process does not stop', async () => {
    const hangingProcess = join(directory, 'hanging-gh-pid');
    const review = Bun.spawn(
      ['script', '--quiet', '--return', '--command', executable, '/dev/null'],
      {
        env: { ...environment, FAKE_GH_HANG: hangingProcess },
        stdin: 'pipe',
        stdout: 'ignore',
        stderr: 'ignore',
      }
    );

    await waitForFile(hangingProcess);
    review.stdin.write('q');
    review.stdin.end();

    expect(await exitWithin(review)).toBe(0);
    const pid = Number(await Bun.file(hangingProcess).text());
    if (Number.isSafeInteger(pid)) {
      await Bun.spawn(['kill', '-KILL', String(pid)], {
        stdout: 'ignore',
        stderr: 'ignore',
      }).exited;
    }
  });

  test('prints an actionable configuration failure and exits nonzero', async () => {
    const invalidConfigHome = join(directory, 'invalid-config');
    await mkdir(join(invalidConfigHome, 'review'), { recursive: true });
    await Bun.write(
      join(invalidConfigHome, 'review', 'config.json'),
      JSON.stringify({
        reviewCommand: 'printf review',
        config: { updateBehavior: 'off' },
      })
    );
    const review = Bun.spawn([executable], {
      env: { ...environment, XDG_CONFIG_HOME: invalidConfigHome },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stderr] = await Promise.all([
      review.exited,
      new Response(review.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('review: Invalid Review configuration');
    expect(stderr).toContain('field github');
    expect(stderr).toContain('Required field is missing');
  });
});

async function writeExecutable(file: string, content: string): Promise<void> {
  await writeFile(file, content);
  await chmod(file, 0o755);
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await Bun.file(file).exists())) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${file}`);
    await Bun.sleep(10);
  }
}

async function exitWithin(process: Bun.Subprocess): Promise<number> {
  return Promise.race([
    process.exited,
    Bun.sleep(10_000).then(() => {
      process.kill();
      throw new Error('Native review executable did not exit');
    }),
  ]);
}

function stripTerminalControls(value: string): string {
  return value.replaceAll(
    /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|P.*?\x1b\\|_G.*?\x1b\\|\[[0-?]*[ -/]*[@-~])/gs,
    ''
  );
}
