# Dead Idea Registry

Append-only. Product-scope cuts are recorded here so they cannot quietly return.

| ID | Idea | Why it initially looked strong | Phase killed | Exact kill reason | Closest prior art / source IDs | Lesson that prevents resurrection |
|---|---|---|---:|---|---|---|
| DEAD-001 | Recipient-selected settlement stablecoin in v1 | It would improve recipient flexibility | 0 | Official Tempo sources do not prove direct onchain FX/liquidity is available now | SRC-004, SRC-005 | Do not simulate an exchange path from a fee-conversion primitive |
| DEAD-002 | MPP as the primary product | Tempo and MPP have current machine-payment tooling | 0 | It risks becoming a parallel product and one-payment-to-one-payout mapping is unproven | SRC-012 | MPP must feed the same vault engine or remain future work |
| DEAD-003 | Backend hot-wallet custody | Fast to prototype | 0 | It creates unsafe pooled accounting and operator-controlled settlement | DIRECTOR-BRIEF | The money path must be enforced by the entitlement contract |

