import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

const workflowPath = join(import.meta.dir, '../.github/workflows/version.yml');
const ciWorkflowPath = join(import.meta.dir, '../.github/workflows/ci.yml');
const changesetWorkflowPath = join(
  import.meta.dir,
  '../.github/workflows/changeset-check.yml'
);
const releaseCondition = "steps.check-release.outputs.needs_binaries == 'true'";
const artifacts = [
  'review-linux-x64',
  'review-linux-arm64',
  'review-darwin-x64',
  'review-darwin-arm64',
];

type WorkflowStep = {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function workflowJob(source: string, name: string): Record<string, unknown> {
  const workflow: unknown = parse(source);
  if (!isRecord(workflow)) throw new Error('Invalid workflow');
  const jobs = workflow['jobs'];
  if (!isRecord(jobs)) throw new Error('Missing workflow jobs');
  const job = jobs[name];
  if (!isRecord(job)) throw new Error(`Missing ${name} job`);
  return job;
}

function workflowSteps(source: string, jobName = 'version'): WorkflowStep[] {
  const steps = workflowJob(source, jobName)['steps'];
  if (!Array.isArray(steps))
    throw new Error(`Missing ${jobName} workflow steps`);

  return steps.map((value) => {
    if (!isRecord(value)) throw new Error('Invalid workflow step');
    return {
      name: typeof value['name'] === 'string' ? value['name'] : undefined,
      uses: typeof value['uses'] === 'string' ? value['uses'] : undefined,
      if: typeof value['if'] === 'string' ? value['if'] : undefined,
      run: typeof value['run'] === 'string' ? value['run'] : undefined,
      with: isRecord(value['with']) ? value['with'] : undefined,
      env: isRecord(value['env']) ? value['env'] : undefined,
    };
  });
}

function namedStep(steps: WorkflowStep[], name: string): WorkflowStep {
  const step = steps.find((candidate) => candidate.name === name);
  if (step === undefined) throw new Error(`Missing workflow step: ${name}`);
  return step;
}

function listedArtifacts(run: string | undefined): string[] {
  if (run === undefined) throw new Error('Workflow step has no run command');
  return run
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('review-'))
    .map((line) => line.replace(/ \\$/, ''));
}

describe('release workflow', () => {
  test('pins the fixed Bun compiler in every CI and release job', async () => {
    const versionFile = '.bun-version';
    expect(
      (await readFile(join(import.meta.dir, '..', versionFile), 'utf8')).trim()
    ).toBe('1.4.4');

    for (const [path, jobs] of [
      [workflowPath, ['version']],
      [ciWorkflowPath, ['test', 'native-artifacts']],
      [changesetWorkflowPath, ['check']],
    ] as const) {
      const source = await readFile(path, 'utf8');
      for (const job of jobs) {
        const setup = workflowSteps(source, job).find(
          (step) => step.uses === 'oven-sh/setup-bun@v2'
        );
        expect(setup?.with?.['bun-version-file']).toBe(versionFile);
      }
    }
  });

  test('builds and starts every artifact on its native runner', async () => {
    const source = await readFile(ciWorkflowPath, 'utf8');
    const job = workflowJob(source, 'native-artifacts');
    const strategy = job['strategy'];
    if (!isRecord(strategy)) throw new Error('Missing native strategy');
    const matrix = strategy['matrix'];
    if (!isRecord(matrix) || !Array.isArray(matrix['include'])) {
      throw new Error('Missing native matrix');
    }

    expect(matrix['include']).toEqual([
      {
        runner: 'ubuntu-24.04',
        target: 'bun-linux-x64',
        artifact: 'review-linux-x64',
      },
      {
        runner: 'ubuntu-24.04-arm',
        target: 'bun-linux-arm64',
        artifact: 'review-linux-arm64',
      },
      {
        runner: 'macos-15-intel',
        target: 'bun-darwin-x64',
        artifact: 'review-darwin-x64',
      },
      {
        runner: 'macos-15',
        target: 'bun-darwin-arm64',
        artifact: 'review-darwin-arm64',
      },
    ]);
    expect(job['runs-on']).toBe('${{ matrix.runner }}');

    const steps = job['steps'];
    if (!Array.isArray(steps)) throw new Error('Missing native steps');
    const commands = steps.flatMap((step) =>
      isRecord(step) && typeof step['run'] === 'string' ? [step['run']] : []
    );
    expect(commands).toContain('bun install --frozen-lockfile');
    expect(commands).toContain(
      'bun build src/cli.tsx --compile --target=${{ matrix.target }} --outfile ${{ matrix.artifact }}'
    );
    expect(commands).toContain('./${{ matrix.artifact }} --version');

    const nativeSteps = workflowSteps(source, 'native-artifacts');
    const verify = namedStep(nativeSteps, 'Verify Apple Silicon signature');
    expect(verify.if).toBe("matrix.target == 'bun-darwin-arm64'");
    expect(verify.run).toBe(
      'codesign --verify --strict --verbose=2 ${{ matrix.artifact }}'
    );
    expect(nativeSteps.indexOf(verify)).toBeLessThan(
      nativeSteps.indexOf(namedStep(nativeSteps, 'Start native artifact'))
    );
  });

  test('repairs every native artifact from the exact release tag', async () => {
    const source = await readFile(workflowPath, 'utf8');
    const steps = workflowSteps(source);

    const checkout = steps.find((step) => step.uses === 'actions/checkout@v7');
    expect(checkout?.with?.['fetch-depth']).toBe(0);

    const detection = namedStep(steps, 'Check if release needs binaries');
    expect(listedArtifacts(detection.run)).toEqual(artifacts);
    expect(detection.run).toContain('needs_binaries=$NEEDS_BINARIES');
    expect(detection.run).toContain('version=$VERSION');

    const changesets = namedStep(
      steps,
      'Create Release Pull Request or Publish'
    );
    expect(changesets.uses).toBe('changesets/action@v1');

    const upload = namedStep(steps, 'Stage release binaries');
    const releaseSteps = [
      namedStep(steps, 'Check out release commit'),
      namedStep(steps, 'Clean release dependencies'),
      namedStep(steps, 'Install release dependencies'),
      namedStep(steps, 'Build linux-x64'),
      namedStep(steps, 'Build linux-arm64'),
      namedStep(steps, 'Build darwin-x64'),
      namedStep(steps, 'Build darwin-arm64'),
      upload,
    ];
    for (const step of releaseSteps) {
      expect(step.if).toBe(releaseCondition);
    }

    expect(releaseSteps[0]?.run).toBe(
      'git checkout --detach --force "refs/tags/${{ steps.check-release.outputs.version }}"'
    );
    expect(releaseSteps[1]?.run).toBe('rm -rf node_modules');
    expect(releaseSteps[2]?.run).toBe(
      "bun install --frozen-lockfile --os='*' --cpu='*'"
    );

    for (const [step, target, artifact] of [
      [releaseSteps[3], 'bun-linux-x64', artifacts[0]],
      [releaseSteps[4], 'bun-linux-arm64', artifacts[1]],
      [releaseSteps[5], 'bun-darwin-x64', artifacts[2]],
      [releaseSteps[6], 'bun-darwin-arm64', artifacts[3]],
    ] as const) {
      expect(step.run).toBe(
        `bun build src/cli.tsx --compile --target=${target} --outfile ${artifact}`
      );
    }

    expect(upload.uses).toBe('actions/upload-artifact@v4');
    expect(upload.with?.['name']).toBe('release-binaries');
    expect(String(upload.with?.['path']).trim().split('\n')).toEqual(artifacts);
    expect(upload.with?.['if-no-files-found']).toBe('error');

    let previousIndex = -1;
    for (const step of [changesets, detection, ...releaseSteps]) {
      const index = steps.indexOf(step);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  test('verifies the staged release binary on macOS before publishing those same bytes', async () => {
    const source = await readFile(workflowPath, 'utf8');
    expect(workflowJob(source, 'version')['outputs']).toEqual({
      needs_binaries: '${{ steps.check-release.outputs.needs_binaries }}',
      version: '${{ steps.check-release.outputs.version }}',
    });
    const job = workflowJob(source, 'publish');
    expect(job['needs']).toBe('version');
    expect(job['if']).toBe("needs.version.outputs.needs_binaries == 'true'");
    expect(job['runs-on']).toBe('macos-15');

    const steps = workflowSteps(source, 'publish');
    const download = namedStep(steps, 'Download release binaries');
    expect(download.uses).toBe('actions/download-artifact@v4');
    expect(download.with?.['name']).toBe('release-binaries');

    const verify = namedStep(steps, 'Verify Apple Silicon signature');
    expect(verify.run).toBe(
      'codesign --verify --strict --verbose=2 review-darwin-arm64'
    );
    const start = namedStep(steps, 'Start Apple Silicon release binary');
    expect(start.run).toContain('chmod +x review-darwin-arm64');
    expect(start.run).toContain('./review-darwin-arm64 --version');

    const upload = namedStep(steps, 'Upload binaries to release');
    expect(listedArtifacts(upload.run)).toEqual(artifacts);
    expect(upload.run).toContain(
      'gh release upload "${{ needs.version.outputs.version }}"'
    );
    expect(upload.run).toContain('--clobber');
    expect(upload.env?.['GH_REPO']).toBe('${{ github.repository }}');
    expect(upload.env?.['GITHUB_TOKEN']).toBe('${{ secrets.GITHUB_TOKEN }}');
    // Never rebuild or re-sign between validation and publication.
    expect(steps).toEqual([download, verify, start, upload]);
  });
});
