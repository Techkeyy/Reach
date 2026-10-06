import type { Address } from "viem";

export type ProtectedFlowPhase = "IDLE" | "BEGINNING" | "BEGIN_CREATED" | "CODE_SENT";

export type ProtectedBeginAttempt = {
  payoutId: string;
  flowId: string;
  challenge: string;
  address: Address;
};

export type ProtectedOtpFlow = {
  payoutId: string;
  flowId: string;
  expiresAt: number;
  resendAvailableAt: number;
  address: Address;
};

export type ProtectedBootSnapshot = {
  generation: number;
  revision: number;
};

/**
 * Monotonic, in-memory state for one mounted recipient claim journey.
 *
 * This deliberately does not persist any protected material. Its purpose is
 * to stop React boot/effect reruns from regressing a flow that has already
 * created a server flow or sent the verification code.
 */
export class ProtectedFlowState {
  private phaseValue: ProtectedFlowPhase = "IDLE";
  private revisionValue = 0;
  private generationValue = 0;
  private beginAttemptValue: ProtectedBeginAttempt | null = null;
  private otpFlowValue: ProtectedOtpFlow | null = null;

  get phase(): ProtectedFlowPhase {
    return this.phaseValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  beginBoot(): ProtectedBootSnapshot {
    this.generationValue += 1;
    return { generation: this.generationValue, revision: this.revisionValue };
  }

  canCommitBoot(snapshot: ProtectedBootSnapshot): boolean {
    return snapshot.generation === this.generationValue
      && snapshot.revision === this.revisionValue
      && this.phaseValue === "IDLE";
  }

  hasAdvancedFlow(): boolean {
    return this.phaseValue !== "IDLE";
  }

  start(payoutId: string, address?: Address): boolean {
    if (this.phaseValue !== "IDLE") return false;
    this.phaseValue = "BEGINNING";
    this.beginAttemptValue = address
      ? { payoutId, flowId: "", challenge: "", address }
      : null;
    this.otpFlowValue = null;
    this.revisionValue += 1;
    return true;
  }

  recordBegin(attempt: ProtectedBeginAttempt): void {
    if (this.phaseValue !== "BEGINNING") return;
    this.phaseValue = "BEGIN_CREATED";
    this.beginAttemptValue = attempt;
    this.revisionValue += 1;
  }

  recordCodeSent(flow: ProtectedOtpFlow): void {
    if (this.phaseValue !== "BEGIN_CREATED") return;
    this.phaseValue = "CODE_SENT";
    this.beginAttemptValue = null;
    this.otpFlowValue = flow;
    this.revisionValue += 1;
  }

  updateOtpFlow(flow: ProtectedOtpFlow): void {
    if (this.phaseValue !== "CODE_SENT" || this.otpFlowValue?.payoutId !== flow.payoutId) return;
    this.otpFlowValue = flow;
    this.revisionValue += 1;
  }

  abortBeginning(): void {
    if (this.phaseValue === "BEGINNING") this.clear();
  }

  beginAttempt(payoutId: string): ProtectedBeginAttempt | null {
    if (this.phaseValue !== "BEGIN_CREATED" || this.beginAttemptValue?.payoutId !== payoutId) return null;
    if (!this.beginAttemptValue.flowId || !this.beginAttemptValue.challenge) return null;
    return this.beginAttemptValue;
  }

  otpFlow(payoutId: string): ProtectedOtpFlow | null {
    if (this.phaseValue !== "CODE_SENT" || this.otpFlowValue?.payoutId !== payoutId) return null;
    return this.otpFlowValue;
  }

  clear(): void {
    this.phaseValue = "IDLE";
    this.beginAttemptValue = null;
    this.otpFlowValue = null;
    this.revisionValue += 1;
  }
}
