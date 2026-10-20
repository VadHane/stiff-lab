// Tiny module-level LRU cache for expensive solves (so toggling a method on/off does not recompute the others).
const store = new Map<string, unknown>();

export function cached<T>(key: string, fn: () => T, max = 48): T {
  if (store.has(key)) {
    const v = store.get(key) as T;
    store.delete(key);
    store.set(key, v);
    return v;
  }
  const v = fn();
  store.set(key, v);
  while (store.size > max) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
  return v;
}
