import test from "node:test";
import assert from "node:assert/strict";
import { Account as TempoAccount } from "viem/tempo";
import { deriveTempoAccountAddress, type WebAuthnCredentialRecord } from "../src/shared/identity";

const publicKeyA = TempoAccount.fromP256(`0x${"11".repeat(32)}`).publicKey;
const publicKeyB = TempoAccount.fromP256(`0x${"22".repeat(32)}`).publicKey;

function credential(id: string, publicKey: WebAuthnCredentialRecord["publicKey"]): WebAuthnCredentialRecord {
  return { id, publicKey, rpId: "localhost" };
}

test("same credential record deterministically reconstructs the same Tempo account", () => {
  const first = deriveTempoAccountAddress(credential("credential-A", publicKeyA));
  const second = deriveTempoAccountAddress(credential("credential-A", publicKeyA));
  assert.equal(first, second);
});

test("Tempo address derives from public key, not credential id", () => {
  const first = deriveTempoAccountAddress(credential("credential-A", publicKeyA));
  const differentCredentialId = deriveTempoAccountAddress(credential("credential-B", publicKeyA));
  assert.equal(differentCredentialId, first);
});

test("changing the credential public key changes the Tempo account", () => {
  const first = deriveTempoAccountAddress(credential("credential-A", publicKeyA));
  const differentPublicKey = deriveTempoAccountAddress(credential("credential-A", publicKeyB));
  assert.notEqual(differentPublicKey, first);
});

test("a server credential record is sufficient to reconstruct the account without browser state", () => {
  const durableCredentialRecord = credential("credential-A", publicKeyA);
  const expected = deriveTempoAccountAddress(durableCredentialRecord);

  // This deliberately does not read a provider store, IndexedDB, a cookie, or
  // a Reach-owned user mapping. It models the server login response handed to
  // the maintained Accounts adapter after credential verification.
  const reconstructed = deriveTempoAccountAddress({ ...durableCredentialRecord });
  assert.equal(reconstructed, expected);
});
