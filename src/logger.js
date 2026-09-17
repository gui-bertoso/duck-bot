const icons = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
  security: '🛡️',
  command: '⌨️',
  moderation: '🔨',
  member: '👤',
};

const colors = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  magenta: '\u001b[35m',
};

const levelColors = {
  info: colors.cyan,
  success: colors.green,
  warning: colors.yellow,
  error: colors.red,
  security: colors.magenta,
  command: colors.cyan,
  moderation: colors.yellow,
  member: colors.magenta,
};

export function initializeTerminal() {
  console.clear();

  const width = 74;
  const line = '═'.repeat(width);

  console.log(`${colors.cyan}╔${line}╗`);
  console.log(`║${center('🦆  DUCK BOT — CENTRAL DE OPERAÇÕES', width)}║`);
  console.log(`║${center('Moderação • Segurança • Tribunal • Auditoria', width)}║`);
  console.log(`╚${line}╝${colors.reset}`);
  console.log(`${colors.dim}Inicializando serviços do bot...${colors.reset}\n`);
}

export function terminalLog(level, message, error, context = {}) {
  const timestamp = new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
  });
  const normalizedLevel = icons[level] ? level : 'info';
  const label = normalizedLevel.toUpperCase().padEnd(10);
  const color = levelColors[normalizedLevel] ?? colors.reset;
  const metadata = formatContext(context);
  const detail = formatError(error);
  const output = `${colors.dim}[${timestamp}]${colors.reset} ${icons[normalizedLevel]} ${color}${label}${colors.reset} ${message}${metadata}${detail}`;

  if (normalizedLevel === 'error') console.error(output);
  else if (normalizedLevel === 'warning') console.warn(output);
  else console.log(output);
}

export function logColor(level) {
  return (
    {
      success: 0x57f287,
      info: 0x5865f2,
      warning: 0xfee75c,
      error: 0xed4245,
      security: 0xeb459e,
      command: 0x5865f2,
      moderation: 0xfee75c,
      member: 0xeb459e,
    }[level] ?? 0x99aab5
  );
}

export function logIcon(level) {
  return icons[level] ?? '•';
}

function center(text, width) {
  const visibleLength = [...text].length;
  const leftPadding = Math.max(0, Math.floor((width - visibleLength) / 2));
  return `${' '.repeat(leftPadding)}${text}`.padEnd(width + (text.length - visibleLength));
}

function formatContext(context) {
  const entries = Object.entries(context).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (!entries.length) return '';

  const values = entries.map(([key, value]) => `${key}=${String(value).replaceAll('\n', ' ')}`);
  return ` ${colors.dim}│ ${values.join(' │ ')}${colors.reset}`;
}

function formatError(error) {
  if (!error) return '';
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `\n${colors.red}${message}${colors.reset}`;
}
