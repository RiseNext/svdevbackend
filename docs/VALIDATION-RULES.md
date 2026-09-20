

> ### ⚠️ D-015 reconciliation banner — 20 Sep 2026
>
> This document predates D-015. Its **field rules remain binding**; three *mechanisms* it names do not.
>
> | This document says | Corrected |
> |---|---|
> | `sortOrder` / `sort_order` as an **integer** | Ordering is Payload's native `orderable: true` — a **fractional-index string**, never exposed publicly (D-021) |
> | A filled honeypot returns **`200`** | The only documented lead success is **`201`**. A `200` is an observable oracle a bot can detect — return `201` for both (plan §9) |
> | Single-valued media role conflict → **`409`** | There is no `project_media` join table. The five roles are named `upload` fields, so the conflict cannot arise (D-032) |
>
> 🔴 **Phone digits (8 vs 10) is OQ-19 and remains PENDING OWNER DECISION.** The live form accepts ≥ 8; this document and `API-CONTRACT.md` say 10. A backend enforcing 10 **rejects submissions the live form accepts today**, so frontend and backend must change in the same release. Nothing here resolves it.
>
> **Authoritative for execution:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) · Correction detail: [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md)

---
