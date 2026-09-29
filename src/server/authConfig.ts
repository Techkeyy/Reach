// Physical passkey ceremonies can include OS/browser UI and user confirmation
// delays. Keep the challenge single-use, but allow enough time for that
// ceremony to complete without expiring during normal human onboarding.
export const AUTH_CHALLENGE_TTL_SECONDS = 10 * 60;

