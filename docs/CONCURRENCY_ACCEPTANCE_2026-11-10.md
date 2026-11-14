# Concurrent workflow acceptance

The final candidate `930ec8b6d68ec0b0c0e39041a51b79ff4fd7caec` runs two additional bounded workloads in the complete release gate. Neither targets hosted businesses nor sends messages or charges a payment provider.

The genuine PostgreSQL test replays the entire migration chain and uses twenty separate connections across twenty synthetic business owners. A deliberate lock barrier establishes twenty overlapping calls per batch. Across eighty competing calls it verified twenty booking winners, twenty booking conflicts, twenty accepted manual payments and twenty rejected excess payments. Forty subsequent requests sharing payment request IDs created only twenty additional payments. Each invoice finished paid at exactly $100 with no overpayment; each business had one appointment. No duplicates remained, and all fixture users/businesses/payments were removed. The observed 154 ms p95 includes the deliberate barrier and is not a production latency estimate. Customer confirmation and signed merchant callbacks remain separate acceptance.

The PDF/Fin/OCR workload uses actual PDF generation and actual request handlers for 300 distinct synthetic business contexts. Identity, quota and provider dependencies are simulated. Each client generates and parses a PDF, verifies a scoped Fin reply and receipt draft, and checks a changed business identity is denied before provider work. All external fetches are rejected. The simulated provider delay is ten milliseconds; JPEG-shaped payloads test upload handling, not image recognition.

| Logical clients | Synthetic businesses | Combined case p95 | Combined case p99 | Unexpected errors |
| --- | --- | --- | --- | --- |
| 10 | 100 | 1,085 ms | 1,087 ms | 0 |
| 50 | 100 | 3,185 ms | 3,186 ms | 0 |
| 100 | 100 | 6,139 ms | 6,140 ms | 0 |

The runner generated 300 PDFs totaling 8,798,175 bytes, processed 300 simulated AI and 300 simulated OCR calls, and recorded peak RSS of 933,949,440 bytes. Total elapsed time was 19,107 ms. External provider cost and network attempts were zero. Higher concurrency increased latency on the shared process; this establishes correctness for the bounded workload, not a hosted response-time target or real provider throughput.

Immutable run/job/artifact identifiers, SHA-256 checksums and full safe aggregates are in `docs/evidence/2026-11-10-commerce-concurrency.json` and `docs/evidence/2026-11-10-provider-workload.json`. These supplement the separate genuine-JWT 300-workspace soak. PERF-01/PERF-02 remain open for hosted pool/TLS budgets, representative hosted load, live worker/provider behavior and their other acceptance criteria.
