import React, { useCallback, useMemo, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { usePublicClient, useSendTransaction } from "wagmi";
import {
  DEFAULT_VAULT_ADDRESS,
  PATH_USD_ADDRESS,
  pathUsdAbi,
  vaultAbi,
} from "../shared/reach";
import { claimSignerForCapability, createClaimCapability, rememberCapability } from "./claimCapability";
import {
  createPayoutId,
  formatPathUsd,
  parsePathUsdAmount,
} from "./senderFlow";
import { SAFE_SUBMISSION_UNCERTAIN, senderFundingRequest } from "./senderFunding";
import { rememberSenderPayout, type SenderPayoutRecord } from "./senderStorage";
import { readChainTimestamp, expiryFromChainTimestamp } from "./chainTime";
import { upsertOperation, updateOperation } from "./operationJournal";
import { submitAndReconcile } from "./submitAndReconcile";
import {
  LayersIcon,
  PlusIcon,
  CloseIcon,
  PasskeyIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  CopyIcon,
  ExternalLinkIcon,
  ArrowRightIcon,
  ClockIcon,
  LockIcon,
} from "./components/Icons";

export type BatchRow = {
  id: string;
  name: string;
  amount: string;
  note: string;
};

type CreatedBatchPayout = {
  payoutId: string;
  name: string;
  amountText: string;
  amountRaw: bigint;
  note: string;
  claimUrl: string;
  claimSigner: Address;
  expiresAt: bigint;
};

type BatchStage = "INPUT" | "PREPARING" | "CONFIRMING" | "SUCCESS" | "FAILED";

type BatchExperienceProps = {
  connectedAddress?: Address;
  pathUsdBalance?: string;
  onDone: () => void;
};

const vaultAddress = ((typeof import.meta !== "undefined" && import.meta.env?.VITE_REACH_VAULT_ADDRESS) || DEFAULT_VAULT_ADDRESS) as Address;
const MAX_BATCH_SIZE = 25;

export function parseBatchCsv(csvText: string): { rows: Omit<BatchRow, "id">[]; error?: string } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], error: "CSV file or text is empty." };
  }

  // Check if first line is a header
  let startIdx = 0;
  const firstCols = lines[0].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
  const isHeader =
    firstCols.length >= 2 &&
    (firstCols[0].toLowerCase() === "name" ||
      firstCols[0].toLowerCase().includes("recipient") ||
      firstCols[1].toLowerCase().includes("amount") ||
      firstCols[1].toLowerCase().includes("pathusd"));

  if (isHeader) {
    startIdx = 1;
  }

  const parsed: Omit<BatchRow, "id">[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i];
    const cols = rawLine.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    if (cols.length < 2) {
      return { rows: [], error: `Line ${i + 1}: Expected at least name and amount (format: name,amount,note).` };
    }

    const name = cols[0];
    const amountStr = cols[1];
    const note = cols.slice(2).join(",") || "";

    if (!name) {
      return { rows: [], error: `Line ${i + 1}: Name cannot be empty.` };
    }

    try {
      const parsedAmount = parsePathUsdAmount(amountStr);
      if (parsedAmount <= 0n) {
        return { rows: [], error: `Line ${i + 1}: Invalid amount "${amountStr}". Must be a positive number.` };
      }
    } catch {
      return { rows: [], error: `Line ${i + 1}: Invalid amount "${amountStr}". Must be a positive number.` };
    }

    parsed.push({
      name,
      amount: amountStr,
      note,
    });
  }

  if (parsed.length === 0) {
    return { rows: [], error: "No valid recipient rows found in CSV." };
  }

  if (parsed.length > MAX_BATCH_SIZE) {
    return { rows: [], error: `Batch size cannot exceed ${MAX_BATCH_SIZE} recipients (found ${parsed.length}).` };
  }

  return { rows: parsed };
}

export default function BatchExperience({
  connectedAddress,
  pathUsdBalance,
  onDone,
}: BatchExperienceProps) {
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  const [inputMode, setInputMode] = useState<"manual" | "csv">("manual");
  const [rows, setRows] = useState<BatchRow[]>([
    { id: "1", name: "", amount: "", note: "" },
    { id: "2", name: "", amount: "", note: "" },
  ]);
  const [csvText, setCsvText] = useState("");
  const [csvParseError, setCsvParseError] = useState<string | null>(null);

  const [stage, setStage] = useState<BatchStage>("INPUT");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdPayouts, setCreatedPayouts] = useState<CreatedBatchPayout[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [allCopied, setAllCopied] = useState(false);

  // Manual row handlers
  const handleAddRow = () => {
    if (rows.length >= MAX_BATCH_SIZE) return;
    setRows((prev) => [
      ...prev,
      { id: Date.now().toString() + Math.random().toString(36).slice(2, 6), name: "", amount: "", note: "" },
    ]);
  };

  const handleRemoveRow = (idx: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateRow = (idx: number, field: keyof Omit<BatchRow, "id">, value: string) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  };

  // CSV apply
  const handleApplyCsv = () => {
    setCsvParseError(null);
    const { rows: parsed, error } = parseBatchCsv(csvText);
    if (error) {
      setCsvParseError(error);
      return;
    }
    const withIds = parsed.map((p, idx) => ({
      id: `${Date.now()}-${idx}`,
      ...p,
    }));
    setRows(withIds);
    setInputMode("manual");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setCsvText(content);
      const { rows: parsed, error } = parseBatchCsv(content);
      if (error) {
        setCsvParseError(error);
      } else {
        setCsvParseError(null);
        const withIds = parsed.map((p, idx) => ({
          id: `${Date.now()}-${idx}`,
          ...p,
        }));
        setRows(withIds);
        setInputMode("manual");
      }
    };
    reader.readAsText(file);
  };

  // Calculations & Validations
  const activeRows = rows.filter((r) => r.name.trim() !== "" || r.amount.trim() !== "");
  const validatedItems = useMemo(() => {
    const valid: { name: string; amountText: string; amountRaw: bigint; note: string }[] = [];
    let hasInvalid = false;

    for (const r of rows) {
      const name = r.name.trim();
      const amountStr = r.amount.trim();
      if (!name && !amountStr) continue;

      if (!name) {
        hasInvalid = true;
        break;
      }
      const raw = parsePathUsdAmount(amountStr);
      if (!raw || raw <= 0n) {
        hasInvalid = true;
        break;
      }
      valid.push({
        name,
        amountText: amountStr,
        amountRaw: raw,
        note: r.note.trim(),
      });
    }

    return { items: valid, isValid: !hasInvalid && valid.length > 0 };
  }, [rows]);

  const totalBatchAmountRaw = useMemo(() => {
    return validatedItems.items.reduce((acc, item) => acc + item.amountRaw, 0n);
  }, [validatedItems]);

  const currentBalanceRaw = useMemo(() => {
    try {
      if (!pathUsdBalance || pathUsdBalance === "0" || pathUsdBalance === "0.00") return 0n;
      return parsePathUsdAmount(pathUsdBalance);
    } catch {
      return 0n;
    }
  }, [pathUsdBalance]);

  const isBalanceSufficient = currentBalanceRaw >= totalBatchAmountRaw;

  // Single passkey batch execution
  const executeBatch = async () => {
    if (!connectedAddress || !validatedItems.isValid || totalBatchAmountRaw === 0n) return;
    if (!isBalanceSufficient) {
      setErrorMessage("Insufficient pathUSD balance for this batch.");
      return;
    }

    setErrorMessage(null);
    setStage("PREPARING");

    try {
      const preparedList: CreatedBatchPayout[] = [];
      const calls: { to: Address; data: `0x${string}`; value: bigint }[] = [];

      // Call 0: approve total batch amount to vault
      const approveData = encodeFunctionData({
        abi: pathUsdAbi,
        functionName: "approve",
        args: [vaultAddress, totalBatchAmountRaw],
      });
      calls.push({ to: PATH_USD_ADDRESS, data: approveData, value: 0n });

      if (!publicClient) throw new Error("chain reader unavailable");
      const chainTimestamp = await readChainTimestamp(publicClient as any);
      const expirySeconds = expiryFromChainTimestamp(chainTimestamp, 7 * 24 * 3600);

      // Calls 1..N: createPayout for each recipient
      for (const item of validatedItems.items) {
        const payoutId = createPayoutId();
        const cap = createClaimCapability();
        rememberCapability(payoutId, cap.raw);
        const claimSigner = claimSignerForCapability(cap.privateKey);

        const createData = encodeFunctionData({
          abi: vaultAbi,
          functionName: "createPayout",
          args: [BigInt(payoutId), item.amountRaw, claimSigner, expirySeconds],
        });

        calls.push({ to: vaultAddress, data: createData, value: 0n });

        const origin = window.location.origin;
        const claimUrl = `${origin}/c/${payoutId}#cap=${cap.raw}`;

        preparedList.push({
          payoutId,
          name: item.name,
          amountText: item.amountText,
          amountRaw: item.amountRaw,
          note: item.note,
          claimUrl,
          claimSigner,
          expiresAt: expirySeconds,
        });
      }

      const createdAt = new Date().toISOString();
      const operationId = `batch:${preparedList.map(p => p.payoutId).join(",")}`;
      const records: SenderPayoutRecord[] = preparedList.map(p => ({
        id: p.payoutId,
        amount: p.amountRaw.toString(),
        expiresAt: p.expiresAt.toString(),
        claimSigner: p.claimSigner,
        label: p.note || `${p.name} (Batch Payout)`,
        createdAt,
        submissionState: "SUBMITTING",
      }));
      // Public records and every bearer are durable before the provider call.
      for (const record of records) rememberSenderPayout(record);
      upsertOperation({ operationType: "BATCH_FUND", operationId, payoutIds: records.map(r => r.id), expectedSender: connectedAddress, expectedExpiry: expirySeconds.toString(), createdAt, submissionBoundaryReached: false, state: "PREPARED" });
      setStage("CONFIRMING");

      const readBatch = async () => {
        const values = await Promise.all(preparedList.map(async p => {
          const result = await (publicClient as any).readContract({ address: vaultAddress, abi: vaultAbi, functionName: "getPayout", args: [BigInt(p.payoutId)] });
          return { status: Number(result.status), amount: result.amount.toString(), expiresAt: result.expiresAt.toString(), claimSigner: String(result.claimSigner), sender: String(result.sender) };
        }));
        return values;
      };
      const persist = (update: Parameters<typeof updateOperation>[1]) => {
        updateOperation(operationId, update);
        for (const record of records) {
          const next: Partial<SenderPayoutRecord> = { ...(update.transactionHash ? { fundingTxHash: update.transactionHash } : {}) };
          if (update.state === "HASH_RECEIVED") next.submissionState = "HASH_RECEIVED";
          if (update.state === "CONFIRMING") next.submissionState = "CONFIRMING_RECEIPT";
          if (update.state === "RECOVERING" || update.state === "SUBMISSION_UNCERTAIN") { next.submissionState = "SUBMISSION_UNCERTAIN"; next.outcome = "RECOVERY_REQUIRED"; }
          if (update.state === "CONFIRMED") next.submissionState = "CONFIRMED";
          if (update.state === "FAILED" || update.state === "FAILED_BEFORE_SUBMISSION") { next.submissionState = "FAILED"; next.outcome = "FAILED"; }
          if (update.failureMessage) next.failureMessage = update.failureMessage;
          if (Object.keys(next).length > 0) rememberSenderPayout({ ...record, ...next });
        }
      };

      const result = await submitAndReconcile({
        operation: { operationType: "BATCH_FUND", operationId, payoutIds: records.map(r => r.id), expectedSender: connectedAddress, expectedExpiry: expirySeconds.toString(), createdAt, submissionBoundaryReached: false, state: "PREPARED" },
        submit: () => sendTransactionAsync(senderFundingRequest(calls) as never),
        readAuthoritativeState: readBatch,
        successPredicate: values => values.every((value, index) => value.status === 1 && value.amount === records[index].amount && value.expiresAt === records[index].expiresAt && value.claimSigner.toLowerCase() === records[index].claimSigner.toLowerCase() && value.sender.toLowerCase() === connectedAddress.toLowerCase()),
        waitForReceipt: async hash => {
          const receipt = await (publicClient as any).waitForTransactionReceipt({ hash });
          return { status: receipt?.status === "success" ? "success" as const : "reverted" as const };
        },
        persist,
        onState: state => {
          if (state === "RECOVERING" || state === "SUBMISSION_UNCERTAIN") setStage("FAILED");
        },
        messages: { failed: "The batch transaction failed. No funds were moved.", uncertain: SAFE_SUBMISSION_UNCERTAIN },
      });

      if (result.transactionHash) setTxHash(result.transactionHash);
      if (result.outcome === "CONFIRMED") {
        setCreatedPayouts(preparedList);
        setStage("SUCCESS");
      } else {
        setErrorMessage(result.message ?? SAFE_SUBMISSION_UNCERTAIN);
        setStage("FAILED");
      }
    } catch {
      setErrorMessage(SAFE_SUBMISSION_UNCERTAIN);
      setStage("FAILED");
    }
  };

  // Copy single link
  const copyLink = (url: string, index: number) => {
    void navigator.clipboard.writeText(url);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Export CSV
  const downloadBatchCsv = () => {
    if (createdPayouts.length === 0) return;
    const header = "Name,Amount (pathUSD),Note,Claim Link,Payout ID,Expires At\n";
    const body = createdPayouts
      .map((p) => `"${p.name}","${formatPathUsd(p.amountRaw)}","${p.note}","${p.claimUrl}","${p.payoutId}","${new Date(Number(p.expiresAt) * 1000).toISOString()}"`)
      .join("\n");

    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reach-batch-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="send-experience-layout" style={{ maxWidth: "760px", margin: "0 auto", padding: "16px" }}>
      {/* View Header */}
      <div className="send-header" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ padding: "10px", background: "var(--bg-subtle)", borderRadius: "var(--radius-md)", color: "var(--primary)" }}>
            <LayersIcon size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, color: "var(--ink-primary)" }}>Batch Payouts</h1>
            <p style={{ fontSize: "13px", color: "var(--ink-muted)", margin: "4px 0 0 0" }}>
              Send pathUSD to up to 25 people in a single atomic passkey transaction.
            </p>
          </div>
        </div>
      </div>

      {/* STAGE: INPUT */}
      {stage === "INPUT" && (
        <div className="send-card-composer" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Mode Switcher */}
          <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-default)", paddingBottom: "12px" }}>
            <button
              type="button"
              className={`filter-tab ${inputMode === "manual" ? "active" : ""}`}
              onClick={() => setInputMode("manual")}
            >
              <span>Manual Entry</span>
            </button>
            <button
              type="button"
              className={`filter-tab ${inputMode === "csv" ? "active" : ""}`}
              onClick={() => setInputMode("csv")}
            >
              <span>CSV Upload / Paste</span>
            </button>
          </div>

          {/* Manual Entry Table */}
          {inputMode === "manual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 2fr 36px", gap: "8px", fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)", padding: "0 4px" }}>
                <span>Recipient Name</span>
                <span>Amount (pathUSD)</span>
                <span>Note / Memo</span>
                <span />
              </div>

              {rows.map((row, idx) => (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1.5fr 2fr 36px",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <input
                    type="text"
                    className="text-input"
                    placeholder="e.g. Alex Rivera"
                    value={row.name}
                    onChange={(e) => handleUpdateRow(idx, "name", e.target.value)}
                    style={{ fontSize: "13px", padding: "8px 12px" }}
                  />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="text-input"
                    placeholder="0.00"
                    value={row.amount}
                    onChange={(e) => handleUpdateRow(idx, "amount", e.target.value)}
                    style={{ fontSize: "13px", padding: "8px 12px" }}
                  />
                  <input
                    type="text"
                    className="text-input"
                    placeholder="e.g. Design bounty"
                    value={row.note}
                    onChange={(e) => handleUpdateRow(idx, "note", e.target.value)}
                    style={{ fontSize: "13px", padding: "8px 12px" }}
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => handleRemoveRow(idx)}
                    disabled={rows.length <= 1}
                    style={{
                      height: "36px",
                      width: "36px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-default)",
                      color: "var(--ink-muted)",
                      background: "var(--bg-surface)",
                      cursor: rows.length <= 1 ? "not-allowed" : "pointer",
                      opacity: rows.length <= 1 ? 0.4 : 1,
                    }}
                    title="Remove recipient"
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              ))}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleAddRow}
                  disabled={rows.length >= MAX_BATCH_SIZE}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "13px" }}
                >
                  <PlusIcon size={14} />
                  <span>Add Recipient ({rows.length}/{MAX_BATCH_SIZE})</span>
                </button>
              </div>
            </div>
          )}

          {/* CSV Paste / Upload */}
          {inputMode === "csv" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ fontSize: "13px", color: "var(--ink-secondary)" }}>
                Upload a CSV file or paste rows below. Format: <code>name,amount,note</code> (one per line).
              </div>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                style={{ fontSize: "13px", padding: "8px 0" }}
              />

              <textarea
                className="text-input"
                rows={6}
                placeholder={"Alex Rivera,25.00,Design grant\nSam Taylor,50.00,Core contributor\nJordan Lee,15.50,Translation"}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                style={{ fontFamily: "monospace", fontSize: "13px", resize: "vertical" }}
              />

              {csvParseError && (
                <div className="error-banner" style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: 6 }}>
                  <AlertCircleIcon size={14} />
                  <span>{csvParseError}</span>
                </div>
              )}

              <button
                type="button"
                className="btn-primary"
                onClick={handleApplyCsv}
                disabled={!csvText.trim()}
                style={{ alignSelf: "flex-start", fontSize: "13px" }}
              >
                <span>Parse and populate rows</span>
              </button>
            </div>
          )}

          {/* Batch Summary Card */}
          <div
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Total Recipients</span>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink-primary)" }}>
                {validatedItems.items.length} {validatedItems.items.length === 1 ? "person" : "people"}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Total Payout Amount</span>
              <span style={{ fontSize: "18px", fontWeight: 800, color: "var(--ink-primary)", fontFeatureSettings: '"tnum" 1' }}>
                ${formatPathUsd(totalBatchAmountRaw)} pathUSD
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Your Balance</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: isBalanceSufficient ? "var(--ink-primary)" : "var(--danger)" }}>
                ${pathUsdBalance ?? "0.00"} pathUSD
              </span>
            </div>

            {!isBalanceSufficient && (
              <div className="error-banner" style={{ fontSize: "12px", marginTop: "4px", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertCircleIcon size={14} />
                <span>Insufficient balance for this batch. Please add more pathUSD to your account.</span>
              </div>
            )}
          </div>

          {/* Action Button */}
          <button
            type="button"
            className="btn-primary btn-large btn-full"
            onClick={() => void executeBatch()}
            disabled={!validatedItems.isValid || totalBatchAmountRaw === 0n || !isBalanceSufficient}
            style={{ marginTop: "4px" }}
          >
            <PasskeyIcon size={20} />
            <span>Approve & Send Batch with Passkey</span>
            <ArrowRightIcon size={18} />
          </button>
        </div>
      )}

      {/* STAGE: PREPARING / CONFIRMING */}
      {(stage === "PREPARING" || stage === "CONFIRMING") && (
        <div className="send-card-composer" style={{ textAlign: "center", padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <div className="signing-spinner" style={{ width: "36px", height: "36px" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--ink-primary)" }}>
            {stage === "PREPARING" ? "Generating batch claim credentials..." : "Confirming batch transaction on Tempo..."}
          </h2>
          <p style={{ fontSize: "13px", color: "var(--ink-muted)", maxWidth: "420px", margin: 0 }}>
            Creating {validatedItems.items.length} payout vaults atomically with a single passkey signature.
          </p>
        </div>
      )}

      {/* STAGE: FAILED */}
      {stage === "FAILED" && (
        <div className="send-card-composer" style={{ textAlign: "center", padding: "36px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <AlertCircleIcon size={40} style={{ color: "var(--danger)" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--ink-primary)" }}>Batch Transaction Failed</h2>
          <p style={{ fontSize: "13px", color: "var(--ink-muted)", maxWidth: "420px", margin: 0 }}>
            {errorMessage || "The transaction could not be completed. No tokens were deducted."}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setStage("INPUT")}
            style={{ marginTop: "8px" }}
          >
            <span>Back to Edit Batch</span>
          </button>
        </div>
      )}

      {/* STAGE: SUCCESS */}
      {stage === "SUCCESS" && (
        <div className="send-card-composer" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Success Banner */}
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <div className="success-icon-animated">
              <svg width="48" height="48" viewBox="0 0 56 56" fill="none">
                <circle cx="28" cy="28" r="26" stroke="var(--success)" strokeWidth="3" className="success-circle-stroke" />
                <path d="M18 29l7 7 14-14" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="success-check-stroke" />
              </svg>
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--ink-primary)" }}>
              Batch Funded Successfully
            </h2>
            <p style={{ fontSize: "13px", color: "var(--ink-muted)", margin: 0 }}>
              {createdPayouts.length} claim links generated. Total: ${formatPathUsd(totalBatchAmountRaw)} pathUSD.
            </p>
            {txHash && (
              <a
                href={`https://moderato.tempo.xyz/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: "12px", color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span>View batch multicall on Tempo Explorer</span>
                <ExternalLinkIcon size={12} />
              </a>
            )}
          </div>

          {/* Security Notice */}
          <div
            style={{
              background: "var(--warning-soft)",
              border: "1px solid var(--warning-border)",
              borderRadius: "var(--radius-md)",
              padding: "12px 16px",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              fontSize: "12px",
              color: "var(--ink-secondary)",
            }}
          >
            <LockIcon size={16} style={{ color: "var(--warning)", flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ color: "var(--ink-primary)" }}>Bearer Key Security:</strong> Claim links contain private authorization credentials. Anyone who opens a link can claim the funds. Share each link privately with its intended recipient.
            </div>
          </div>

          {/* Export Action Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink-primary)" }}>
              Claim Links ({createdPayouts.length})
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={downloadBatchCsv}
              style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <LayersIcon size={14} />
              <span>Download CSV</span>
            </button>
          </div>

          {/* Claim Links List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "320px", overflowY: "auto", paddingRight: "4px" }}>
            {createdPayouts.map((p, idx) => (
              <div
                key={p.payoutId}
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink-primary)" }}>{p.name}</span>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--success)" }}>${formatPathUsd(p.amountRaw)} pathUSD</span>
                  </div>
                  {p.note && <span style={{ fontSize: "11px", color: "var(--ink-muted)" }}>{p.note}</span>}
                </div>

                <button
                  type="button"
                  className={`btn-copy ${copiedIndex === idx ? "btn-copied" : "btn-secondary"}`}
                  onClick={() => copyLink(p.claimUrl, idx)}
                  style={{ minHeight: "32px", padding: "6px 12px", fontSize: "12px" }}
                >
                  <CopyIcon size={12} />
                  <span>{copiedIndex === idx ? "Copied" : "Copy link"}</span>
                </button>
              </div>
            ))}
          </div>

          {/* Bottom Done Button */}
          <button
            type="button"
            className="btn-primary btn-large btn-full"
            onClick={onDone}
            style={{ marginTop: "8px" }}
          >
            <span>Done and Return to Activity</span>
          </button>
        </div>
      )}
    </div>
  );
}
