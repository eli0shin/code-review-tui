export {};

const title = process.argv[2] ?? 'Review Command';
const detail = process.argv[3] ?? 'octo-org/example #123';

const enterAlternateScreen = '\u001b[?1049h';
const leaveAlternateScreen = '\u001b[?1049l';
const clearScreen = '\u001b[2J\u001b[H';
const hideCursor = '\u001b[?25l';
const showCursor = '\u001b[?25h';

function draw(): void {
  process.stdout.write(
    `${enterAlternateScreen}${clearScreen}${hideCursor}` +
      `\u001b[1;36m${title}\u001b[0m\r\n\r\n` +
      `${detail}\r\n\r\n` +
      'This mock process owns an interactive terminal.\r\n' +
      'Press q to finish and return.\r\n'
  );
}

function restore(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write(`${showCursor}${leaveAlternateScreen}`);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
draw();

for await (const chunk of process.stdin) {
  const input = Buffer.from(chunk).toString('utf8');
  if (input.includes('q') || input.includes('\u0003')) break;
}

restore();
