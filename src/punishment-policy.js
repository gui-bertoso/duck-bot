export function decideAutomaticAction({ points, violation, threshold = 3 }) {
  if (violation.type === 'phishing' && violation.severity >= 5) {
    return { type: 'ban', label: 'banimento imediato', tribunal: true };
  }

  if (points >= threshold + 2) {
    return { type: 'timeout', minutes: 60, label: 'timeout de 1 hora', tribunal: true };
  }

  if (points >= threshold) {
    return { type: 'timeout', minutes: 10, label: 'timeout de 10 minutos', tribunal: true };
  }

  return { type: 'warning', label: 'warning', tribunal: false };
}
