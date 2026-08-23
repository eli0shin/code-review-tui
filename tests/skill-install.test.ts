import { afterEach, describe, expect, jest, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../src/cli.tsx';
import {
  installReviewCommentsSkill,
  reviewCommentsSkill,
  type SkillInstallDependencies,
} from '../src/commands/skill-install.ts';

const expectedSkill = `---
name: review-comments
description: Read the Lumen review comments saved for the pull request under review.
disable-model-invocation: true
---

Read the review comments for the pull request under review from \`/tmp/review/lumen/<org>/<repo>/<pull-request-number>.txt\`.
`;
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'review-skill-install-'));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('review-comments skill installation', () => {
  test('creates the exact Agent Skills file under the user home', async () => {
    const home = await temporaryDirectory();

    const destination = await installReviewCommentsSkill({
      homeDirectory: () => home,
      makeDirectory: mkdir,
      writeFile,
    });

    expect(destination).toBe(
      join(home, '.agents', 'skills', 'review-comments', 'SKILL.md')
    );
    expect(await readFile(destination, 'utf8')).toBe(expectedSkill);
    expect(reviewCommentsSkill).toBe(expectedSkill);
  });

  test('unconditionally replaces existing content on every install', async () => {
    const home = await temporaryDirectory();
    const destination = join(
      home,
      '.agents',
      'skills',
      'review-comments',
      'SKILL.md'
    );
    await mkdir(join(home, '.agents', 'skills', 'review-comments'), {
      recursive: true,
    });
    await writeFile(destination, 'user-edited content');

    await installReviewCommentsSkill({
      homeDirectory: () => home,
      makeDirectory: mkdir,
      writeFile,
    });
    await writeFile(destination, 'different content');
    await installReviewCommentsSkill({
      homeDirectory: () => home,
      makeDirectory: mkdir,
      writeFile,
    });

    expect(await readFile(destination, 'utf8')).toBe(expectedSkill);
  });

  test('rejects an unusable home before touching the filesystem', async () => {
    const makeDirectory = jest.fn<SkillInstallDependencies['makeDirectory']>();
    const writeSkill = jest.fn<SkillInstallDependencies['writeFile']>();

    await expect(
      installReviewCommentsSkill({
        homeDirectory: () => '',
        makeDirectory,
        writeFile: writeSkill,
      })
    ).rejects.toThrow('user home directory is unavailable');
    expect(makeDirectory).toHaveBeenCalledTimes(0);
    expect(writeSkill).toHaveBeenCalledTimes(0);
  });

  test('reports the destination and filesystem failure without changing another file', async () => {
    const home = await temporaryDirectory();
    const blocker = join(home, '.agents');
    const unrelated = join(home, 'unrelated.txt');
    await writeFile(blocker, 'not a directory');
    await writeFile(unrelated, 'unchanged');

    await expect(
      installReviewCommentsSkill({
        homeDirectory: () => home,
        makeDirectory: mkdir,
        writeFile,
      })
    ).rejects.toThrow(
      `Cannot install the review-comments skill at ${join(home, '.agents', 'skills', 'review-comments', 'SKILL.md')}`
    );
    expect(await readFile(unrelated, 'utf8')).toBe('unchanged');
  });
});

describe('skill CLI surface', () => {
  test('exposes only the install skill-management operation', () => {
    const program = createProgram({ executablePath: undefined });
    const skillCommand = program.commands.find(
      (command) => command.name() === 'skill'
    );

    expect(skillCommand).toBeDefined();
    expect(skillCommand?.commands.map((command) => command.name())).toEqual([
      'install',
    ]);
    expect(skillCommand?.helpInformation()).toContain(
      'install the review-comments agent skill'
    );
  });
});
