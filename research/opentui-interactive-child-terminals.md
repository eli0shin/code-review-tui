# OpenTUI control of interactive child terminals

## Scope

This note checks `@opentui/core` and `@opentui/react` 0.5.6 with Bun 1.3.14. It separates two different operations:

1. **Embedded session**: a child runs on its own pseudo-terminal (PTY), and OpenTUI draws its terminal emulator inside the Review Queue.
2. **Physical-terminal handoff**: OpenTUI releases the user's terminal, one child uses it directly, and OpenTUI takes it back after that child exits.

OpenTUI supplies the display and terminal-session APIs. It does not launch a process or create a PTY. Its embedded-terminal guide states this limit directly.[^embedded-doc]

## Finding

Choose the mechanism from each tool's accepted launch contract:

- **Lumen requires physical-terminal foreground handoff.** Suspend OpenTUI, run `lumen diff` as a foreground child on the same controlling terminal, wait for it, and restore OpenTUI. Do not replace this contract with an embedded PTY.[^lumen-contract]
- **Embedded sessions remain available for tools whose contracts permit a PTY.** For such a tool, combine `Bun.spawn(command, { terminal: ... })`, one retained `EmbeddedTerminalRenderable`, output through `write()`, input through `onData` and `Bun.Terminal.write()`, resize through `onTerminalResize` and `Bun.Terminal.resize()`, and layout-visible clipped panels with `focus()` and `blur()` for switching.

Both mechanisms need explicit process and terminal cleanup. `CliRenderer.suspend()` and `resume()` suspend and resume OpenTUI, not a child. Physical handoff cannot by itself support instant switching among concurrent child applications.

## Capability matrix

| Need | Embedded session | Physical-terminal handoff |
| --- | --- | --- |
| Launch | `Bun.spawn(..., { terminal })` | `renderer.suspend()`, then spawn with inherited standard streams |
| Display | `EmbeddedTerminalRenderable.write()` | Child writes directly to the user's terminal |
| Input | Focused renderable encodes keys, paste, focus, and mouse; `onData` writes bytes to the PTY | Child owns terminal input while OpenTUI is suspended |
| Alternate-screen state | The retained Ghostty VT terminal owns the child screen state | Child owns the real terminal; OpenTUI exits and later re-enters its configured screen |
| Resize | `onTerminalResize(cols, rows)` calls `terminal.resize(cols, rows)` | The foreground child receives normal terminal resize behavior; OpenTUI reads current dimensions after return |
| Switch | Keep each session mounted and layout-visible; blur and move the old panel outside a clipped viewport, then move/focus the new one | Not a multi-session switch mechanism |
| Suspend child execution | Not required for switching; moving a panel off-screen does not stop the process | Not provided by `CliRenderer.suspend()` |
| Shutdown | Kill and await the child, close its PTY, destroy its renderable, then destroy the app renderer | Kill and await an active child, then destroy the suspended renderer |

## Select by tool contract

An embedded PTY changes the terminal boundary: OpenTUI remains the physical-terminal owner while a Ghostty emulator represents the child's terminal. Use this mode only when the tool's accepted contract permits that boundary and its required output fits the embedded renderer's limits. A need for concurrent switching does not override a physical-terminal launch contract.

The merged Lumen contract requires the foreground physical terminal, so the Review Queue must use handoff for Lumen. The Review Command and other tools can use embedded sessions only after their own contracts explicitly permit a PTY. This note does not make that later lifecycle decision.

## Embedded session contract

### Launch and connect

Bun's `terminal` spawn option attaches stdin, stdout, and stderr to one PTY. The returned `proc.terminal` supplies `write()`, `resize()`, `close()`, `ref()`, and `unref()`. The actual process result is `proc.exited`; the terminal `exit` callback reports PTY EOF or error, not the child exit code.[^bun-pty]

OpenTUI's first-party example gives the required wiring:[^embedded-example]

```ts
const initialCols = 80
const initialRows = 24

const terminal = new EmbeddedTerminalRenderable(renderer, {
  id: sessionId,
  cols: initialCols,
  rows: initialRows,
  width: "100%",
  flexGrow: 1,
  onData(data) {
    child?.terminal?.write(data)
  },
  onTerminalResize(cols, rows) {
    child?.terminal?.resize(cols, rows)
  },
})

child = Bun.spawn(command, {
  cwd,
  env: {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  },
  terminal: {
    cols: initialCols,
    rows: initialRows,
    data(_pty, data) {
      terminal.write(data)
    },
  },
})
```

Both `onData` sources, `"input"` and `"response"`, must go to the PTY. The response bytes include replies to child terminal queries. Filtering them can break an interactive program.[^embedded-doc]

### Preserve state and switch

`EmbeddedTerminalRenderable` owns a Ghostty VT terminal, its screen, scrollback, cursor state, and mode-aware input encoders.[^embedded-native] Keep one renderable and one PTY alive for each session. Continue to send child output to `write()` when the session is not active. This retains the emulator's current main or alternate screen and keeps output current.

For a switch:

1. Put each session in an absolute panel that keeps the viewport width and height. Keep the terminal renderable `visible = true` for layout. Put inactive panels outside a parent with `overflow = "hidden"`, so they keep their grid size but do not paint or receive pointer input in the viewport.
2. Consume the host switch key before it reaches the focused child. OpenTUI renderer key listeners run before focused-renderable input.[^embedded-doc]
3. Blur the old terminal and move its panel outside the clipped viewport.
4. Move the selected panel into the viewport and call `focus()` on its terminal.
5. Forward every `onTerminalResize` call to that session's PTY.[^embedded-source]

Do not set an inactive terminal to `visible = false`. OpenTUI records layout size changes while a renderable is hidden, but `onLayoutResize()` only calls `onResize()` while it is visible. If the hidden layout size is already current when the terminal becomes visible, no resize callback occurs. The emulator and PTY can then retain their old grid.[^renderable-source] Keeping every terminal layout-visible avoids this missed activation resize, at the cost of composing inactive sessions when their output changes.

Do not destroy or replace a session only because it becomes inactive. `destroy()` frees the native emulator. Core `remove()` is only detachment, but React deletion then calls `destroyRecursively()` on the detached renderable.[^lifecycle-doc][^react-host] Thus, conditional React removal loses the emulator state. It still does not clean up the separately owned child and PTY. Keep inactive React sessions mounted and layout-visible.

### React integration

There is no built-in React `<embedded-terminal>` element. Use the Core object from a React-owned session controller, or register it with React `extend()` and add the `OpenTUIComponents` TypeScript declaration. React constructs an extended renderable with its props.[^react-doc][^react-host]

The session controller, not a React component key, should own the child and PTY. A stable ref to the renderable lets the controller change focus and perform ordered cleanup. Keep all sessions mounted and select one by panel placement, not by React deletion or `visible = false`.

### Resize details

For percentage or flex dimensions, the emulator starts at explicit `cols` and `rows`, or at 80 by 24. Create the PTY with that same initial grid. OpenTUI only calls `onTerminalResize` after a visible computed size change. It does not promise an initial callback when numeric dimensions already match.[^embedded-doc]

Therefore:

- pass the initial grid to both objects;
- forward every later `onTerminalResize` call;
- keep the child output callback active while inactive; and
- keep inactive terminal renderables layout-visible, off-screen, and clipped so parent resize causes `onTerminalResize` before later activation.

### Input boundaries

When focused, the renderable encodes keyboard protocol modes, bracketed paste, terminal focus, and cell-based mouse protocols. The child controls these modes through its VT output. A host-level key handler can reserve session-switch commands before focused-renderable delivery.[^embedded-doc][^embedded-source]

Known display limits are important for tools such as diff viewers and editors: the embedded renderer draws the character grid but does not compose child Kitty graphics or Sixel images. Pixel mouse mode 1016 is also not forwarded because the renderable only has cell coordinates.[^embedded-doc]

## Physical-terminal handoff boundary

This is the required mechanism for the fixed Lumen integration.[^lumen-contract] The OpenTUI part of a real-terminal handoff is `renderer.suspend()` before launch and `renderer.resume()` after the child returns. `suspend()` stops rendering, removes OpenTUI's stdin data listener, disables raw mode and mouse input, pauses stdin, removes renderer exit listeners, and runs the native terminal shutdown sequence. `resume()` restores raw input and listeners, restores the previous renderer control state, and requests a full repaint.[^renderer-source] The native shutdown sequence leaves OpenTUI's alternate screen and resets terminal modes; resume sets up the configured screen again.[^renderer-native]

These APIs are **not a complete handoff contract**. A child launched with inherited standard streams normally remains in the parent's foreground process group. Terminal-generated signals such as Ctrl+C are sent to the terminal's foreground process group and can reach both processes.[^posix-terminal] Because `suspend()` removes OpenTUI's exit listeners, the parent can terminate before any JavaScript `finally` block calls `resume()`. Job-control signals need the same explicit treatment. OpenTUI and Bun do not supply foreground-process-group transfer as part of these APIs.

The external-process lifecycle contract must first define and test parent signal survival, child signal forwarding, job control, and platform behavior. After that policy is active, the launch must use this shape:

```ts
installHandoffSignalPolicy()
renderer.suspend()
try {
  await runChildOnInheritedTerminal(command)
} finally {
  renderer.resume()
  removeHandoffSignalPolicy()
}
```

The `finally` protects launch failures and normal child completion only while the process remains alive. Do not present it as protection from terminal-generated process termination. Also, do not use `pause()` for handoff: paused renderers can still perform one-shot renders, while suspended renderers reject render requests and release terminal input modes.[^renderer-doc][^renderer-tests]

This model has one physical foreground terminal owner. It does not preserve several directly attached children or switch among them. Embedded PTYs can provide concurrency only for tools whose accepted contracts permit that terminal boundary.

## Clean shutdown ownership

OpenTUI's default signal handlers only destroy the renderer. Renderer destruction does not close application-owned children, PTYs, or transports.[^lifecycle-doc] The application must own one asynchronous shutdown path and disable or replace the default signal behavior when child cleanup must complete.

Recommended order for each embedded session:

1. stop accepting input and blur it;
2. signal the child;
3. await `child.exited`, with an application-defined timeout and force-kill fallback;
4. call `child.terminal.close()` after the process is no longer running;
5. destroy the `EmbeddedTerminalRenderable`;
6. after all sessions are closed, unmount the React root and call `renderer.destroy()` in a nested `finally`.

Killing before PTY close also avoids Bun's documented delay when closing a ConPTY that still has a running child on older Windows releases.[^bun-pty] `Subprocess.kill()` signals the process handle; neither Bun's PTY API nor OpenTUI defines whole-process-tree termination. The external-process lifecycle contract must separately define process groups, descendant termination, timeouts, and platform behavior.

A launch can fail before a child handle exists. Track each acquired resource separately and clean only what was created. `renderer.destroy()` and renderable `destroy()` are idempotent, but PTY and child completion remain application-owned.[^lifecycle-doc][^embedded-doc]

## Platform and version constraints

- `@opentui/core` 0.5.6 requires Bun 1.3 or newer.[^core-package]
- Embedded Ghostty VT support is published for x86-64 and ARM64 on macOS, Linux glibc, Linux musl, and Windows GNU. Construction throws on unsupported targets.[^embedded-doc]
- Bun uses `openpty()` on Linux and macOS and ConPTY on Windows. ConPTY can produce semantically equivalent but byte-different VT output. A Node or Bun child under ConPTY can miss `SIGWINCH` unless it reads stdin in raw mode, although its terminal row and column values still update.[^bun-pty]
- OpenTUI's embedded paint does not include Kitty graphics or Sixel images.[^embedded-doc]

## Answer for the Review Queue design

OpenTUI supports both terminal boundaries, but the application must not choose one boundary for all tools:

- Launch the fixed Lumen integration with physical-terminal foreground handoff, as its merged contract requires.
- Keep embedded Bun PTYs and retained `EmbeddedTerminalRenderable` instances as an available concurrent-switching mechanism for tools whose contracts permit a PTY.
- Leave the Review Command boundary open until its external-process contract selects it.

OpenTUI React does not provide an embedded terminal as a standard JSX component or process manager. If a PTY-compatible tool uses this mechanism, the application needs a session controller and either a small `extend()` registration or an imperative Core integration.

[^lumen-contract]: [Merged `lumen diff` launch contract](lumen-diff-launch-contract.md#terminal-ownership-and-return-of-control)
[^embedded-doc]: [OpenTUI: Embedded terminal](https://opentui.com/docs/components/embedded-terminal/)
[^embedded-source]: [`EmbeddedTerminalRenderable` source at OpenTUI 0.5.6](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/core/src/renderables/EmbeddedTerminal.ts)
[^embedded-native]: [OpenTUI native embedded-terminal implementation](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/native/src/embedded-terminal/main.zig)
[^embedded-example]: [OpenTUI embedded-terminal example](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/examples/src/embedded-terminal-demo.ts)
[^bun-pty]: [Bun: Terminal (PTY) support](https://bun.sh/docs/runtime/child-process#terminal-pty-support)
[^posix-terminal]: [POSIX: General terminal interface, controlling terminal and foreground process group](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap11.html#tag_11_01_03)
[^renderable-source]: [OpenTUI Core `Renderable.visible` source](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/core/src/Renderable.ts)
[^react-doc]: [OpenTUI: React bindings and component extension](https://opentui.com/docs/bindings/react/)
[^react-host]: [OpenTUI React host configuration](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/react/src/reconciler/host-config.ts)
[^lifecycle-doc]: [OpenTUI: Lifecycle and cleanup](https://opentui.com/docs/core-concepts/lifecycle/)
[^renderer-source]: [`CliRenderer.suspend()` and `resume()` source](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/core/src/renderer.ts#L4123-L4218)
[^renderer-native]: [OpenTUI native renderer terminal setup and shutdown](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/native/src/renderer.zig)
[^renderer-doc]: [OpenTUI: Renderer](https://opentui.com/docs/core-concepts/renderer/)
[^renderer-tests]: [OpenTUI renderer control tests](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/core/src/tests/renderer.control.test.ts)
[^core-package]: [`@opentui/core` 0.5.6 package metadata](https://github.com/anomalyco/opentui/blob/fa20a6bc20a519f24b2d01e1b66f7ed11ba3732b/packages/core/package.json)
