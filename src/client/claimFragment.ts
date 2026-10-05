export type ConsumedClaimFragment<Protected, Instant> =
  | { kind: "PROTECTED"; value: Protected }
  | { kind: "INSTANT"; value: Instant };

/**
 * Consume a claim URL fragment before parsing it. The clear callback is
 * intentionally invoked before either parser so malformed secret-bearing
 * fragments cannot remain visible in browser history or the address bar.
 */
export function consumeClaimFragment<Protected, Instant>(
  hash: string,
  clear: () => void,
  parseProtected: (fragment: string) => Protected,
  parseInstant: (fragment: string) => Instant,
): ConsumedClaimFragment<Protected, Instant> {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  clear();

  const value = normalized.startsWith("cap=") ? normalized.slice(4) : normalized;
  if (value.startsWith("p_")) return { kind: "PROTECTED", value: parseProtected(value) };
  return { kind: "INSTANT", value: parseInstant(value) };
}
