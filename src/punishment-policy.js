export function decideAutomaticAction({ points, violation, threshold = 3 }) {
  if (violation.type === 'phishing' && violation.severity >= 5) {
    return { type: 'ban', label: 'immediate ban', tribunal: true };
  }

  if (points >= threshold + 2) {
    return { type: 'timeout', minutes: 60, label: 'timeout de 1 hora', tribunal: true };
  }

  if (points >= threshold) {
    return { type: 'timeout', minutes: 10, label: '10-minute timeout', tribunal: true };
  }

  return { type: 'warning', label: 'warning', tribunal: false };
}
