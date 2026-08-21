// Three tool-switching models, selected with 1/2/3, on the accepted Review Queue surface.
import {
  EmbeddedTerminalRenderable,
  RGBA,
  createCliRenderer,
  rgbToHex,
  type CliRenderer,
  type TerminalColors,
} from '@opentui/core';
import { createRoot, extend, useKeyboard, useRenderer } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';

extend({ embeddedTerminal: EmbeddedTerminalRenderable });

declare module '@opentui/react' {
  // OpenTUI defines this extension point as an interface.
  // eslint-disable-next-line for-ai/no-interface, @typescript-eslint/consistent-type-definitions
  interface OpenTUIComponents {
    embeddedTerminal: typeof EmbeddedTerminalRenderable;
  }
}

type SystemTheme = {
  foreground: RGBA;
  background: RGBA;
  textMuted: RGBA;
  subtleSurface: RGBA;
};

type Variant = 'handoff' | 'hybrid' | 'herdr';
type Tool = 'Lumen' | 'Review Command';
type PullRequest = {
  title: string;
  repository: string;
  number: number;
  author: string;
  files: number;
  additions: number;
  deletions: number;
  url: string;
  isDraft: boolean;
  state: string;
  createdAt: string;
  updatedAt: string;
};
type Session = { id: string; tool: Tool; pullRequest: PullRequest };

const worktree = import.meta.dir.replace(/\/src$/, '');
const mockToolPath = `${import.meta.dir}/tool-surface.prototype.ts`;
const reviewCommand =
  process.env.REVIEW_PROTOTYPE_COMMAND ??
  `${shellQuote(process.execPath)} ${shellQuote(mockToolPath)} ${shellQuote('Review Command')}`;

const pullRequests: PullRequest[] = [
  {
    title: 'Bootstrap the review application shell',
    repository: 'eli0shin/code-review-tui',
    number: 5,
    author: 'eli0shin',
    files: 41,
    additions: 3338,
    deletions: 20,
    url: 'https://github.com/eli0shin/code-review-tui/pull/5',
    isDraft: false,
    state: 'merged',
    createdAt: '2026-08-21T15:18:44Z',
    updatedAt: '2026-08-21T16:46:50Z',
  },
  {
    title: 'Add keyboard navigation to the queue',
    repository: 'octo-org/platform',
    number: 318,
    author: 'monalisa',
    files: 7,
    additions: 184,
    deletions: 42,
    url: 'https://github.com/octo-org/platform/pull/318',
    isDraft: false,
    state: 'open',
    createdAt: '2026-08-20T09:14:00Z',
    updatedAt: '2026-08-21T13:08:00Z',
  },
  {
    title: 'Tighten API retry behavior',
    repository: 'octo-org/api',
    number: 91,
    author: 'hubot',
    files: 3,
    additions: 63,
    deletions: 28,
    url: 'https://github.com/octo-org/api/pull/91',
    isDraft: false,
    state: 'open',
    createdAt: '2026-08-19T18:41:00Z',
    updatedAt: '2026-08-21T11:27:00Z',
  },
];

const variantDetails = {
  handoff: {
    number: '1',
    name: 'Full handoff',
    summary: 'Simple and portable; only one surface can be active.',
  },
  hybrid: {
    number: '2',
    name: 'Hybrid OpenTUI',
    summary: 'Lumen and Review Commands remain switchable in-process.',
  },
  herdr: {
    number: '3',
    name: 'Herdr tabs',
    summary: 'Every tool is concurrent; Herdr is a required runtime.',
  },
} satisfies Record<Variant, { number: string; name: string; summary: string }>;

function ToolSwitchingPrototype() {
  const renderer = useRenderer();
  const theme = useSystemTheme();
  const [variant, setVariant] = useState<Variant>('handoff');
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const pullRequest = getPullRequest(selected);

  async function launch(tool: Tool): Promise<void> {
    setMessage('');
    if (variant === 'handoff') {
      setBusy(true);
      await runPhysicalHandoff(renderer, tool, pullRequest);
      setBusy(false);
      return;
    }
    if (variant === 'hybrid') {
      const id = `${tool}:${pullRequest.url}`;
      setSessions((current) =>
        current.some((session) => session.id === id)
          ? current
          : [...current, { id, tool, pullRequest }]
      );
      setActiveSession(id);
      return;
    }
    const result = launchHerdrTab(tool, pullRequest);
    if (!result.ok) setMessage(result.message);
  }

  useKeyboard((key) => {
    if (key.eventType === 'release') return;
    if (activeSession !== null) {
      if (
        key.name === 'x' &&
        !key.ctrl &&
        !key.meta &&
        !key.shift &&
        !key.option
      ) {
        key.preventDefault();
        key.stopPropagation();
        setActiveSession(null);
      }
      return;
    }
    if (busy) return;
    if (key.name === 'q') renderer.destroy();
    if (key.name === '1') setVariant('handoff');
    if (key.name === '2') setVariant('hybrid');
    if (key.name === '3') setVariant('herdr');
    if (key.name === 'j' || key.name === 'down') {
      setSelected((index) => (index + 1) % pullRequests.length);
    }
    if (key.name === 'k' || key.name === 'up') {
      setSelected(
        (index) => (index - 1 + pullRequests.length) % pullRequests.length
      );
    }
    if (key.name === 'd') void launch('Lumen');
    if (key.name === 'r') void launch('Review Command');
  });

  const details = variantDetails[variant];
  return (
    <box width="100%" height="100%" position="relative" overflow="hidden">
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        position="absolute"
        left={activeSession === null ? 0 : '100%'}
        padding={1}
      >
        <text fg="#8b949e">Review Queue · tool-switching prototype</text>
        <text>
          <span fg="#f0f6fc">{details.name}</span>
          <span fg="#8b949e"> — {details.summary}</span>
        </text>
        <box height={1} />
        {pullRequests.map((item, index) => (
          <box
            key={item.url}
            flexDirection="column"
            paddingX={1}
            backgroundColor={index === selected ? '#202832' : undefined}
          >
            <text>
              <span fg="#3fb950">● </span>
              <span fg="#f0f6fc">{item.title}</span>
            </text>
            <text>
              <span fg="#8b949e">
                {'  '}
                {item.repository} #{item.number} · @{item.author} · {item.files}{' '}
                files{' '}
              </span>
              <span fg="#3fb950">+{item.additions}</span>
              <span fg="#8b949e"> </span>
              <span fg="#f85149">-{item.deletions}</span>
            </text>
          </box>
        ))}
        <box height={1} />
        <text fg="#8b949e">j/k move · d Lumen · r Review Command · q quit</text>
        {variant === 'hybrid' && sessions.length > 0 ? (
          <text fg="#8b949e">
            {sessions.length} retained tool session(s); d/r reopens the selected
            one
          </text>
        ) : null}
        {message === '' ? null : <text fg="#f85149">{message}</text>}
        <box flexGrow={1} />
        <text>
          {(['handoff', 'hybrid', 'herdr'] as const).map((candidate) => (
            <span
              key={candidate}
              fg={candidate === variant ? '#f0f6fc' : '#8b949e'}
            >
              {candidate === variant ? '●' : '○'}{' '}
              {variantDetails[candidate].number}{' '}
              {variantDetails[candidate].name}{' '}
            </span>
          ))}
        </text>
      </box>
      {sessions.map((session) => (
        <box
          key={session.id}
          width="100%"
          height="100%"
          position="absolute"
          left={activeSession === session.id ? 0 : '100%'}
        >
          <EmbeddedReviewCommand
            active={activeSession === session.id}
            theme={theme}
            session={session}
            onExit={() => {
              setSessions((current) =>
                current.filter((candidate) => candidate.id !== session.id)
              );
              setActiveSession((current) =>
                current === session.id ? null : current
              );
            }}
          />
        </box>
      ))}
    </box>
  );
}

function EmbeddedReviewCommand({
  active,
  theme,
  session,
  onExit,
}: {
  active: boolean;
  theme: SystemTheme | undefined;
  session: Session;
  onExit: () => void;
}) {
  const [terminal, setTerminal] = useState<EmbeddedTerminalRenderable | null>(
    null
  );
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    if (terminal === null) return;
    const command =
      session.tool === 'Lumen'
        ? ['lumen', 'diff', session.pullRequest.url]
        : ['/bin/sh', '-c', reviewCommand];
    const child = Bun.spawn(command, {
      cwd: worktree,
      env: {
        ...process.env,
        ...reviewEnvironment(session.pullRequest),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
      terminal: {
        cols: 80,
        rows: 24,
        data(_pty, data) {
          terminal.write(data);
        },
      },
    });
    terminal.onData = (data) => child.terminal?.write(data);
    terminal.onTerminalResize = (cols, rows) =>
      child.terminal?.resize(cols, rows);
    void child.exited.then(() => {
      if (child.exitCode !== null) exitRef.current();
    });
    return () => {
      if (child.exitCode === null) child.kill();
      child.terminal?.close();
    };
  }, [session, terminal]);

  useEffect(() => {
    if (active) terminal?.focus();
    else terminal?.blur();
  }, [active, terminal]);

  useEffect(() => {
    if (terminal === null || theme === undefined) return;
    terminal.write(
      `\u001b]10;${rgbToHex(theme.foreground)}\u0007` +
        `\u001b]11;${rgbToHex(theme.background)}\u0007`
    );
  }, [terminal, theme]);

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme?.background}
    >
      <box paddingX={1} height={1} backgroundColor={theme?.subtleSurface}>
        <text fg={theme?.textMuted}>
          {session.tool} · {session.pullRequest.repository} #
          {session.pullRequest.number} · x returns to queue
        </text>
      </box>
      <embeddedTerminal
        ref={setTerminal}
        cols={80}
        rows={24}
        style={{ width: '100%', flexGrow: 1 }}
      />
    </box>
  );
}

async function runPhysicalHandoff(
  renderer: CliRenderer,
  tool: Tool,
  pullRequest: PullRequest
): Promise<void> {
  renderer.suspend();
  try {
    const command =
      tool === 'Lumen'
        ? ['lumen', 'diff', pullRequest.url]
        : ['/bin/sh', '-c', reviewCommand];
    const child = Bun.spawn(command, {
      cwd: worktree,
      env: {
        ...process.env,
        ...reviewEnvironment(pullRequest),
      },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    await child.exited;
  } finally {
    renderer.resume();
  }
}

function launchHerdrTab(
  tool: Tool,
  pullRequest: PullRequest
): { ok: true } | { ok: false; message: string } {
  const workspaceId = process.env.HERDR_WORKSPACE_ID;
  const returnTabId = process.env.HERDR_TAB_ID;
  if (process.env.HERDR_ENV !== '1' || !workspaceId || !returnTabId) {
    return {
      ok: false,
      message: 'Herdr model requires review to start inside a Herdr pane.',
    };
  }
  const created = Bun.spawnSync(
    [
      'herdr',
      'tab',
      'create',
      '--workspace',
      workspaceId,
      '--cwd',
      worktree,
      '--label',
      `${tool} · #${pullRequest.number}`,
      '--focus',
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  if (created.exitCode !== 0) {
    return {
      ok: false,
      message: Buffer.from(created.stderr).toString('utf8').trim(),
    };
  }
  const response = parseCreatedTab(
    JSON.parse(Buffer.from(created.stdout).toString('utf8'))
  );
  if (response === undefined) {
    return { ok: false, message: 'Herdr returned an invalid tab response.' };
  }
  const { tabId, paneId } = response;
  const toolCommand =
    tool === 'Lumen'
      ? `lumen diff ${shellQuote(pullRequest.url)}`
      : `/bin/sh -c ${shellQuote(reviewCommand)}`;
  const environment = Object.entries(reviewEnvironment(pullRequest)).map(
    ([name, value]) => `export ${name}=${shellQuote(value)}`
  );
  const command = [
    ...environment,
    toolCommand,
    `herdr tab focus ${shellQuote(returnTabId)}`,
    `herdr tab close ${shellQuote(tabId)}`,
  ].join('; ');
  const started = Bun.spawnSync(['herdr', 'pane', 'run', paneId, command], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (started.exitCode !== 0) {
    Bun.spawnSync(['herdr', 'tab', 'close', tabId]);
    return {
      ok: false,
      message: Buffer.from(started.stderr).toString('utf8').trim(),
    };
  }
  return { ok: true };
}

function useSystemTheme(): SystemTheme | undefined {
  const renderer = useRenderer();
  const [theme, setTheme] = useState<SystemTheme>();

  useEffect(() => {
    let active = true;
    void renderer
      .getPalette({ size: 16 })
      .then((colors) => {
        if (active) setTheme(generateSystemTheme(colors));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [renderer]);

  return theme;
}

function generateSystemTheme(colors: TerminalColors): SystemTheme | undefined {
  const background = colors.defaultBackground ?? colors.palette[0];
  if (background === null) return undefined;
  const bg = RGBA.fromHex(background);
  const fg = RGBA.fromHex(
    colors.defaultForeground ?? colors.palette[7] ?? '#c0c0c0'
  );
  const isDark = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b <= 0.5;
  return {
    foreground: fg,
    background: bg,
    textMuted: generateMutedTextColor(bg, isDark),
    subtleSurface: tint(bg, fg, isDark ? 0.14 : 0.1),
  };
}

function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * alpha) * 255),
    Math.round((base.g + (overlay.g - base.g) * alpha) * 255),
    Math.round((base.b + (overlay.b - base.b) * alpha) * 255)
  );
}

// Ported from OpenCode v2 so muted text follows terminal contrast.
function generateMutedTextColor(background: RGBA, isDark: boolean): RGBA {
  const backgroundLuminance =
    0.299 * background.r * 255 +
    0.587 * background.g * 255 +
    0.114 * background.b * 255;
  const gray = isDark
    ? backgroundLuminance < 10
      ? 180
      : Math.min(Math.floor(160 + backgroundLuminance * 0.3), 200)
    : backgroundLuminance > 245
      ? 75
      : Math.max(Math.floor(100 - (255 - backgroundLuminance) * 0.2), 60);
  return RGBA.fromInts(gray, gray, gray);
}

function reviewEnvironment(pullRequest: PullRequest): Record<string, string> {
  return {
    REVIEW_PR_URL: pullRequest.url,
    REVIEW_PR_REPOSITORY: pullRequest.repository,
    REVIEW_PR_NUMBER: String(pullRequest.number),
    REVIEW_PR_TITLE: pullRequest.title,
    REVIEW_PR_AUTHOR: pullRequest.author,
    REVIEW_PR_IS_DRAFT: String(pullRequest.isDraft),
    REVIEW_PR_STATE: pullRequest.state,
    REVIEW_PR_CREATED_AT: pullRequest.createdAt,
    REVIEW_PR_UPDATED_AT: pullRequest.updatedAt,
  };
}

function getPullRequest(index: number): PullRequest {
  const pullRequest = pullRequests.at(index);
  if (pullRequest === undefined) throw new Error('Invalid prototype selection');
  return pullRequest;
}

function parseCreatedTab(
  value: unknown
): { tabId: string; paneId: string } | undefined {
  if (!isRecord(value) || !isRecord(value.result)) return undefined;
  const { tab, root_pane: rootPane } = value.result;
  if (!isRecord(tab) || !isRecord(rootPane)) return undefined;
  if (typeof tab.tab_id !== 'string' || typeof rootPane.pane_id !== 'string') {
    return undefined;
  }
  return { tabId: tab.tab_id, paneId: rootPane.pane_id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<ToolSwitchingPrototype />);
