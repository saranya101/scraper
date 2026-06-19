const queues = new Map();

export function enqueue(key, task) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(key, next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }));
  return next;
}
