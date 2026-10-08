export const PROTECTED_RESEND_ERROR = "Couldn't resend the code. Try again shortly.";

export function protectedResendMessage(
  state: "idle" | "sending" | "resent",
  maskedRecipient?: string,
): string {
  if (state === "sending") return "Sending...";
  if (state === "resent") return "Code resent";
  return `A code was sent to ${maskedRecipient ?? "your verified channel"}.`;
}
