import React, { useState } from "react";

type AccountAddressProps = {
  address?: string;
};

export function abbreviateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function AccountAddress({ address }: AccountAddressProps) {
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="account-address-card" aria-label="Your Reach address">
      <div>
        <span className="balance-eyebrow">Your Reach address</span>
        <code className="account-address-value" title={address}>{abbreviateAddress(address)}</code>
      </div>
      <button type="button" className="btn-secondary" onClick={() => void copyAddress()}>
        {copied ? "Copied" : "Copy address"}
      </button>
    </section>
  );
}
