import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

export const reviewCommentsSkill = `---
name: review-comments
description: Read the Lumen review comments saved for the pull request under review.
disable-model-invocation: true
---

Read the review comments for the pull request under review from \`/tmp/review/lumen/<org>/<repo>/<pull-request-number>.txt\`.
`;

export type SkillInstallDependencies = {
  readonly homeDirectory: () => string;
  readonly makeDirectory: (
    path: string,
    options: { readonly recursive: true }
  ) => Promise<unknown>;
  readonly writeFile: (
    path: string,
    content: string,
    encoding: 'utf8'
  ) => Promise<unknown>;
};

const defaultDependencies = {
  homeDirectory: homedir,
  makeDirectory: mkdir,
  writeFile,
} satisfies SkillInstallDependencies;

export async function installReviewCommentsSkill(
  dependencies: SkillInstallDependencies = defaultDependencies
): Promise<string> {
  const home = dependencies.homeDirectory();
  if (home === '' || !isAbsolute(home)) {
    throw new Error(
      'Cannot install the review-comments skill because the user home directory is unavailable'
    );
  }

  const destination = join(
    home,
    '.agents',
    'skills',
    'review-comments',
    'SKILL.md'
  );
  try {
    await dependencies.makeDirectory(dirname(destination), { recursive: true });
    await dependencies.writeFile(destination, reviewCommentsSkill, 'utf8');
    return destination;
  } catch (error) {
    throw new Error(
      `Cannot install the review-comments skill at ${destination}: ${describeError(error)}`
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
