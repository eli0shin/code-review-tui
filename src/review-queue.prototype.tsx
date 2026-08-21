// PROTOTYPE — throwaway Review Queue variants for ticket 007.
// Three structurally different TUI variants, switchable with left/right or 1/2/3.
import {
  createCliRenderer,
  RGBA,
  TextAttributes,
  type TerminalColors,
} from '@opentui/core';
import { createRoot, useKeyboard, useRenderer } from '@opentui/react';
import { useEffect, useState } from 'react';

type PullRequest = {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly updated: string;
  readonly labels: readonly string[];
  readonly comments: number;
  readonly additions: number;
  readonly deletions: number;
  readonly files: number;
  readonly description: string;
};

const pullRequests: readonly PullRequest[] = [
  {
    repository: 'acme/payments',
    number: 1842,
    title: 'Prevent duplicate captures during gateway retries',
    author: 'maria-s',
    updated: '18m',
    labels: ['bug', 'payments'],
    comments: 7,
    additions: 126,
    deletions: 43,
    files: 8,
    description:
      'Adds an idempotency guard around capture attempts and records the gateway request key with the payment operation.',
  },
  {
    repository: 'acme/design-system',
    number: 611,
    title: 'Add compact density to data tables',
    author: 'lee',
    updated: '1h',
    labels: ['ui', 'accessibility'],
    comments: 3,
    additions: 89,
    deletions: 21,
    files: 5,
    description:
      'Introduces compact row spacing while retaining the existing keyboard focus and minimum target-size behavior.',
  },
  {
    repository: 'acme/identity',
    number: 927,
    title: 'Move session revocation to the event pipeline',
    author: 'devon',
    updated: '3h',
    labels: ['security'],
    comments: 12,
    additions: 244,
    deletions: 198,
    files: 17,
    description:
      'Publishes revocation events and removes the synchronous fan-out from the authentication request path.',
  },
  {
    repository: 'oss/opentui',
    number: 143,
    title: 'Restore cursor state after alternate-screen exit',
    author: 'cass',
    updated: '6h',
    labels: ['terminal'],
    comments: 2,
    additions: 41,
    deletions: 9,
    files: 3,
    description:
      'Captures the cursor state before renderer startup and restores it when an alternate-screen renderer stops.',
  },
  {
    repository: 'acme/reporting',
    number: 302,
    title: 'Stream large exports directly to object storage',
    author: 'ravi',
    updated: '1d',
    labels: ['performance'],
    comments: 5,
    additions: 173,
    deletions: 76,
    files: 11,
    description:
      'Replaces in-memory export buffering with a bounded stream and multipart object-storage upload.',
  },
];

const variants = [
  { key: 'A', name: 'Terminal inverse' },
  { key: 'B', name: 'ANSI accent' },
  { key: 'C', name: 'Subtle surface' },
] as const;

type QueueState = 'ready' | 'loading' | 'empty';

type SystemTheme = {
  readonly success: RGBA;
  readonly error: RGBA;
  readonly info: RGBA;
  readonly secondary: RGBA;
  readonly warning: RGBA;
  readonly textMuted: RGBA;
  readonly foreground: RGBA;
  readonly background: RGBA;
  readonly subtleSurface: RGBA;
};

function PrototypeApp() {
  const theme = useSystemTheme();
  const [variant, setVariant] = useState(0);
  const [selected, setSelected] = useState(0);
  const [queueState, setQueueState] = useState<QueueState>('ready');
  const [showHelp, setShowHelp] = useState(false);

  useKeyboard((key) => {
    if (key.name === 'q') process.exit(0);
    if (key.name === 'left') setVariant((value) => (value + 2) % 3);
    if (key.name === 'right') setVariant((value) => (value + 1) % 3);
    if (key.name === '1' || key.name === '2' || key.name === '3') {
      setVariant(Number(key.name) - 1);
    }
    if (key.name === 'j' || key.name === 'down') {
      setSelected((value) => Math.min(value + 1, pullRequests.length - 1));
    }
    if (key.name === 'k' || key.name === 'up') {
      setSelected((value) => Math.max(value - 1, 0));
    }
    if (key.name === 'l') setQueueState('loading');
    if (key.name === 'e') setQueueState('empty');
    if (key.name === 'r') setQueueState('ready');
    if (key.name === '?') setShowHelp((value) => !value);
    if (key.name === 'escape') setShowHelp(false);
  });

  const content =
    queueState === 'loading' ? (
      <StatusView
        title="Loading review requests…"
        detail="Running the configured GitHub search"
      />
    ) : queueState === 'empty' ? (
      <StatusView
        title="No reviews waiting"
        detail="Press r to refresh the configured search"
      />
    ) : (
      <GitHubList
        selected={selected}
        theme={theme}
        selectionVariant={variant}
      />
    );

  return (
    <box width="100%" height="100%" flexDirection="column">
      {content}
      <PrototypeSwitcher variant={variant} queueState={queueState} />
      {showHelp ? <HelpOverlay /> : null}
    </box>
  );
}

function GitHubList({
  selected,
  theme,
  selectionVariant,
}: {
  readonly selected: number;
  readonly theme: SystemTheme | undefined;
  readonly selectionVariant: number;
}) {
  const selection = getSelectionColors(theme, selectionVariant);
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingRight={2}>
      <box height={3} alignItems="center" justifyContent="space-between">
        <text>
          <strong>Review requests</strong>{' '}
          <span attributes={TextAttributes.DIM}>
            {pullRequests.length} open
          </span>
        </text>
        <text attributes={TextAttributes.DIM}>updated just now r refresh</text>
      </box>
      <box flexDirection="column">
        {pullRequests.map((pr, index) => {
          const preserveColors = index === selected && selectionVariant === 2;
          return (
            <box
              key={pr.repository + pr.number}
              width="100%"
              height={4}
              paddingLeft={1}
              paddingRight={1}
              flexDirection="column"
              justifyContent="center"
              backgroundColor={
                index === selected ? selection?.background : undefined
              }
            >
              <text
                fg={
                  index === selected && !preserveColors
                    ? selection?.text
                    : undefined
                }
              >
                {index === selected && !preserveColors ? (
                  `● ${pr.title}`
                ) : (
                  <>
                    <span fg={theme?.success}>● </span>
                    <strong>{pr.title}</strong>
                  </>
                )}
              </text>
              {index === selected && !preserveColors ? (
                <text fg={selection?.text}>
                  {'  '}
                  {pr.repository} #{pr.number} opened by {pr.author} · updated{' '}
                  {pr.updated} · {pr.files} files +{pr.additions} -
                  {pr.deletions} · {pr.comments} comments ·{' '}
                  {pr.labels.join('  ')}
                </text>
              ) : (
                <text>
                  {'  '}
                  <span fg={theme?.info}>{pr.repository}</span>
                  <span fg={theme?.textMuted}> #{pr.number} opened by </span>
                  <span fg={theme?.secondary}>{pr.author}</span>
                  <span fg={theme?.textMuted}>
                    {' '}
                    · updated {pr.updated} · {pr.files} files{' '}
                  </span>
                  <span fg={theme?.success}>+{pr.additions}</span>{' '}
                  <span fg={theme?.error}>-{pr.deletions}</span>
                  <span fg={theme?.textMuted}>
                    {' '}
                    · {pr.comments} comments ·{' '}
                  </span>
                  <span fg={theme?.warning}>{pr.labels.join('  ')}</span>
                </text>
              )}
            </box>
          );
        })}
      </box>
      <text attributes={TextAttributes.DIM}>
        {' '}
        j/k move d diff c review command s submit review ? help
      </text>
    </box>
  );
}

function _ReviewInbox({ selected }: { readonly selected: number }) {
  const current = pullRequests[selected];
  return (
    <box flexGrow={1} flexDirection="column">
      <box
        height={3}
        paddingLeft={2}
        paddingRight={2}
        alignItems="center"
        justifyContent="space-between"
        backgroundColor="#161b22"
      >
        <text>
          <strong fg="#f0f6fc">review</strong>
          <span fg="#8b949e"> / inbox</span>
        </text>
        <text fg="#8b949e">{pullRequests.length} need attention</text>
      </box>
      <box flexGrow={1} flexDirection="row">
        <box
          width="42%"
          flexDirection="column"
          border
          borderColor="#30363d"
          title="QUEUE"
          titleColor="#8b949e"
        >
          {pullRequests.map((pr, index) => (
            <box
              key={pr.repository + pr.number}
              height={5}
              paddingLeft={1}
              paddingRight={1}
              flexDirection="column"
              justifyContent="center"
              backgroundColor={index === selected ? '#21262d' : '#0d1117'}
              border={index === selected ? ['left'] : false}
              borderColor="#58a6ff"
            >
              <text fg="#8b949e">
                {pr.repository} <span fg="#58a6ff">#{pr.number}</span>{' '}
                {pr.updated}
              </text>
              <text>
                <strong fg="#f0f6fc">{pr.title}</strong>
              </text>
              <text fg="#8b949e">
                @{pr.author} {pr.labels.join(' · ')}
              </text>
            </box>
          ))}
        </box>
        <box flexGrow={1} padding={2} flexDirection="column" gap={1}>
          <text fg="#8b949e">
            {current.repository} / pull / {current.number}
          </text>
          <text>
            <strong fg="#f0f6fc">{current.title}</strong>
          </text>
          <text fg="#8b949e">
            opened by <span fg="#58a6ff">@{current.author}</span> · updated{' '}
            {current.updated}
          </text>
          <box
            marginTop={1}
            marginBottom={1}
            border={['top', 'bottom']}
            borderColor="#30363d"
            paddingTop={1}
            paddingBottom={1}
          >
            <text fg="#c9d1d9">{current.description}</text>
          </box>
          <text>
            <span fg="#3fb950">+{current.additions}</span>{' '}
            <span fg="#f85149">−{current.deletions}</span>{' '}
            <span fg="#8b949e">{current.comments} comments</span>
          </text>
          <box marginTop={1} flexDirection="row" gap={2}>
            <text>
              <strong fg="#f0f6fc">[d] Open diff</strong>
            </text>
            <text>
              <strong fg="#f0f6fc">[c] Run review</strong>
            </text>
            <text>
              <strong fg="#f0f6fc">[s] Submit</strong>
            </text>
          </box>
        </box>
      </box>
    </box>
  );
}

function _TriageTable({ selected }: { readonly selected: number }) {
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box height={3} alignItems="center" justifyContent="space-between">
        <text>
          <strong fg="#f0f6fc">REVIEW QUEUE</strong>
          <span fg="#8b949e">
            {' '}
            github search · {pullRequests.length} results
          </span>
        </text>
        <text fg="#8b949e">r refresh ? keys</text>
      </box>
      <box
        height={2}
        backgroundColor="#21262d"
        paddingLeft={1}
        alignItems="center"
      >
        <text fg="#8b949e"> REPOSITORY PR TITLE AUTHOR AGE Δ</text>
      </box>
      {pullRequests.map((pr, index) => (
        <box
          key={pr.repository + pr.number}
          height={3}
          paddingLeft={1}
          flexDirection="column"
          justifyContent="center"
          backgroundColor={
            index === selected
              ? '#1f6feb'
              : index % 2 === 0
                ? '#0d1117'
                : '#161b22'
          }
        >
          <text fg="#f0f6fc">
            {index === selected ? '›' : ' '} {fit(pr.repository, 23)}{' '}
            {fit(`#${pr.number}`, 7)} {fit(pr.title, 42)}{' '}
            {fit(`@${pr.author}`, 12)} {fit(pr.updated, 5)}{' '}
            <span fg={index === selected ? '#ffffff' : '#3fb950'}>
              +{pr.additions}
            </span>
            /
            <span fg={index === selected ? '#ffffff' : '#f85149'}>
              -{pr.deletions}
            </span>
          </text>
          <text fg={index === selected ? '#dbeafe' : '#8b949e'}>
            {' '}
            {pr.labels.join(' · ')} · {pr.comments} comments
          </text>
        </box>
      ))}
      <box flexGrow={1} />
      <box
        height={3}
        border={['top']}
        borderColor="#30363d"
        alignItems="center"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg="#c9d1d9">↑↓ navigate enter/d diff c command s submit</text>
        <text fg="#8b949e">
          selected {selected + 1}/{pullRequests.length}
        </text>
      </box>
    </box>
  );
}

function StatusView({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <box
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      gap={1}
    >
      <text>
        <strong fg="#f0f6fc">{title}</strong>
      </text>
      <text fg="#8b949e">{detail}</text>
    </box>
  );
}

function PrototypeSwitcher({
  variant,
  queueState,
}: {
  readonly variant: number;
  readonly queueState: QueueState;
}) {
  const current = variants[variant] ?? variants[0];
  return (
    <box
      height={3}
      border={['top']}
      borderColor="#30363d"
      backgroundColor="#161b22"
      alignItems="center"
      justifyContent="center"
    >
      <text>
        <span fg="#8b949e">← </span>
        <strong fg="#f0f6fc">
          {current.key} — {current.name}
        </strong>
        <span fg="#8b949e">
          {' '}
          → 1/2/3 variants l loading e empty r ready state: {queueState}
        </span>
      </text>
    </box>
  );
}

function HelpOverlay() {
  return (
    <box
      position="absolute"
      left="25%"
      top="20%"
      width="50%"
      height={14}
      border
      borderStyle="double"
      borderColor="#58a6ff"
      backgroundColor="#161b22"
      padding={1}
      flexDirection="column"
    >
      <text>
        <strong fg="#f0f6fc">Prototype keys</strong>
      </text>
      <text fg="#c9d1d9">j/k or ↑/↓ move selection</text>
      <text fg="#c9d1d9">←/→ or 1/2/3 switch variant</text>
      <text fg="#c9d1d9">l / e / r loading, empty, ready states</text>
      <text fg="#c9d1d9">? or escape close this help</text>
      <text fg="#c9d1d9">q quit</text>
      <text attributes={TextAttributes.DIM}>
        Actions are visual only. This prototype does not run commands.
      </text>
    </box>
  );
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
  if (!background) return undefined;

  const bg = RGBA.fromHex(background);
  const foreground = colors.defaultForeground ?? colors.palette[7] ?? '#c0c0c0';
  const fg = RGBA.fromHex(foreground);
  const isDark = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b <= 0.5;
  const color = (index: number, fallback: string) =>
    RGBA.fromHex(colors.palette[index] ?? fallback);

  return {
    success: color(2, '#008000'),
    error: color(1, '#800000'),
    info: color(6, '#008080'),
    secondary: color(5, '#800080'),
    warning: color(3, '#808000'),
    textMuted: generateMutedTextColor(bg, isDark),
    foreground: fg,
    background: bg,
    subtleSurface: tint(bg, fg, isDark ? 0.14 : 0.1),
  };
}

function getSelectionColors(
  theme: SystemTheme | undefined,
  variant: number
): { readonly background: RGBA; readonly text: RGBA } | undefined {
  if (theme === undefined) return undefined;
  if (variant === 1) {
    return { background: theme.info, text: theme.background };
  }
  if (variant === 2) {
    return { background: theme.subtleSurface, text: theme.foreground };
  }
  return { background: theme.foreground, text: theme.background };
}

function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * alpha) * 255),
    Math.round((base.g + (overlay.g - base.g) * alpha) * 255),
    Math.round((base.b + (overlay.b - base.b) * alpha) * 255)
  );
}

// Ported from OpenCode v2's system theme so muted text follows terminal contrast.
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

function fit(value: string, width: number): string {
  if (value.length > width) return `${value.slice(0, width - 1)}…`;
  return value.padEnd(width);
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<PrototypeApp />);
