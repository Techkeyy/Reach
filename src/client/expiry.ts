export type PayoutExpirySelection =
  | { kind: "PRESET"; seconds: number }
  | { kind: "CUSTOM"; localDateTime: string };

export const PAYOUT_EXPIRY_MIN_SECONDS = 10 * 60;
export const PAYOUT_EXPIRY_MAX_SECONDS = 30 * 24 * 60 * 60;

export const PAYOUT_EXPIRY_PRESETS = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 86400, label: "24 hours" },
  { seconds: 259200, label: "3 days" },
  { seconds: 604800, label: "7 days" },
] as const;

function customDateTimeToSeconds(localDateTime: string): bigint {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime)) {
    throw new Error("Choose a valid expiration date and time.");
  }
  const milliseconds = Date.parse(localDateTime);
  if (!Number.isFinite(milliseconds)) throw new Error("Choose a valid expiration date and time.");
  return BigInt(Math.floor(milliseconds / 1000));
}

export function resolvePayoutExpiry(chainTimestamp: bigint, selection: PayoutExpirySelection): bigint {
  const expiresAt = selection.kind === "PRESET"
    ? chainTimestamp + BigInt(selection.seconds)
    : customDateTimeToSeconds(selection.localDateTime);
  const lifetime = expiresAt - chainTimestamp;
  if (lifetime < PAYOUT_EXPIRY_MIN_SECONDS) {
    throw new Error("Expiration must be at least 10 minutes from the current Tempo time.");
  }
  if (lifetime > PAYOUT_EXPIRY_MAX_SECONDS) {
    throw new Error("Expiration cannot be more than 30 days from the current Tempo time.");
  }
  return expiresAt;
}

export function formatPayoutExpiry(expiresAt: string | bigint): string {
  const milliseconds = Number(BigInt(expiresAt)) * 1000;
  if (!Number.isSafeInteger(milliseconds)) return "Expiration unavailable";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(milliseconds));
}

export function localTimeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "your local time";
}
