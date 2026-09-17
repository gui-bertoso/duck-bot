const counters = {
  commands: 0,
  errors: 0,
  moderationActions: 0,
  automaticWarnings: 0,
};

export function incrementMetric(name) {
  if (Object.hasOwn(counters, name)) counters[name] += 1;
}

export function getMetrics(client) {
  const memory = process.memoryUsage();
  return {
    ...counters,
    ping: Math.max(0, Math.round(client.ws.ping)),
    uptime: client.uptime ?? 0,
    memoryMb: Math.round(memory.rss / 1024 / 1024),
  };
}
