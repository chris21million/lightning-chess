export function shortKey(pk: string) {
  return `${pk.slice(0, 8)}…${pk.slice(-8)}`;
}
