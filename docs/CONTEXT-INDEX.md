# CONTEXT-INDEX.md — Documentation map

All backend specification documents live in `svbackend/docs/`. **No backend code exists yet.**

> **Updated 20 Sep 2026.** Three documents were added by the implementation investigation. **Read `MASTER-IMPLEMENTATION-PLAN.md` before implementing anything** — it supersedes `BACKEND-ROADMAP.md` on phase structure and corrects Payload-specific assumptions across this set. Several documents below are **not yet corrected**; `DOCUMENTATION-CORRECTIONS.md` says which, and `ARCHITECTURE.md` and `SECURITY.md` carry correction banners at the top.

## Reading order for a new session

| # | Document | Read when | Purpose |
|---|---|---|---|
| 1 | **`AI-CONTEXT.md`** | **Always, first** | Master orientation: what the project is, **selected architecture**, scope boundaries, forbidden assumptions. **§11b carries the five corrections that change what gets built.** |
| 1b | **`IMPLEMENTATION-DECISION.md`** | **Before any implementation** | **The architecture decision: Payload CMS 3 (D-015).** Why, what it changes, and the Phase 1 validation gate |
| 1c | **`MASTER-IMPLEMENTATION-PLAN.md`** | **Before any implementation** | **The definitive blueprint.** Final architecture, entity model, public API, auth, media, leads, security, migrations, testing, deployment, critical path, exact implementation order, and the official-documentation evidence (§32). **Supersedes `BACKEND-ROADMAP.md` on phase structure.** |
| 1d | **`MASTER-IMPLEMENTATION-CHECKLIST.md`** | **While implementing** | Every task as a verifiable checkbox, phase by phase, with a Definition of Done per phase |
| 1e | **`MIGRATION-001-DECISIONS.md`** | **Before writing `payload.config.ts` or running the first migration** | The six decisions that become expensive-to-impossible after migration 001. Five resolved on technical grounds; **one (OQ-25, multilingual) is the owner's and is still open**, with a safe default already applied |
| 1f | **`DOCUMENTATION-CORRECTIONS.md`** | **Before trusting any technical detail in an uncorrected document** | The 92-finding conflict audit's verified corrections — what was applied, what awaits owner review, and the dependency-ordered plan to apply the rest |
| 2 | `PRD.md` | Before any feature work | Product vision, users, confirmed vs inferred scope |
| 3 | `REQUIREMENTS.md` | Before implementing | Numbered functional + non-functional requirements (`FR-*`, `NFR-*`) |
| 4 | `CONTENT-MANAGEMENT-MATRIX.md` | Before touching content/CMS | **The CMS boundary** — what is admin-editable vs frontend code |
| 5 | `ADMIN-CMS-SPEC.md` | Before building admin features | Screen-by-screen admin behaviour |
| 6 | `API-CONTRACT.md` | Before building endpoints | Public + admin API, request/response/errors |
| 7 | `DATABASE-SCHEMA.md` | Before migrations | Tables, keys, indexes, relationships |
| 8 | `OPEN-QUESTIONS.md` | **Always, before assuming anything** | Unresolved business decisions |

## Full document set

### Scope and product
| Document | Contains |
|---|---|
| `AI-CONTEXT.md` | Master context. **Selected architecture (§2b).** Source-of-truth hierarchy. Forbidden assumptions |
| `IMPLEMENTATION-DECISION.md` | **Custom backend vs headless CMS, evaluated across 40 criteria. Decision: Payload CMS 3.** Compatibility impact on the API, database and admin specs. Risks and the Phase 1 gate |
| `PRD.md` | Vision, problem, users, public + admin experience, functional/non-functional requirements, future scope |
| `REQUIREMENTS.md` | Numbered, traceable requirements with CONFIRMED / INFERRED / FUTURE / OPEN status |
| `CONTENT-MANAGEMENT-MATRIX.md` | Line-by-line frontend content → CMS classification. **Primary implementation reference** |
| `ADMIN-CMS-SPEC.md` | Admin screens: purpose, data, actions, forms, validation, API calls, states |

### Technical design
| Document | Contains |
|---|---|
| `ARCHITECTURE.md` | System shape, stack recommendation, request flows, frontend integration strategy |
| `API-CONTRACT.md` | Versioned public + admin API, envelopes, status codes, examples |
| `DATABASE-SCHEMA.md` | Entities, fields, types, PK/FK, indexes, ER relationships, deletion behaviour |
| `MEDIA-MANAGEMENT.md` | Upload, storage, validation, serving, deletion, orphan handling |
| `VALIDATION-RULES.md` | Every field rule, frontend vs backend, shared across API and DB |
| `INTEGRATIONS.md` | Email, WhatsApp, maps, storage — what is needed and what is optional |
| `SECURITY.md` | Auth, sessions, authorization, CORS, uploads, secrets, audit, hardening |

### Process and governance
| Document | Contains |
|---|---|
| `BACKEND-ROADMAP.md` | Phased implementation plan with entry/exit criteria |
| `TRACEABILITY.md` | Frontend source → requirement → API → DB → UI → test |
| `OPEN-QUESTIONS.md` | Blocking and non-blocking decisions awaiting the owner |
| `DECISIONS.md` | Decision log — what was decided, when, why, and what it supersedes |

### External reference
| Document | Location | Contains |
|---|---|---|
| `BACKEND-REQUIREMENTS.md` | `../../` (workspace root) | Original forensic frontend audit. Evidence base. **Superseded on scope** (see `DECISIONS.md` D-001) but still authoritative on *what the frontend contains* |
| Frontend source | `../../svfrontend/src/` | **The primary technical source of truth** |
| Frontend PRD | `../../svfrontend/docs/PRD-redesign.md` | Design rationale, reference design, out-of-scope notes |
| Frontend README | `../../svfrontend/README.md` | Conventions, performance budgets, "before you go live" list |

## Maintenance rules

- A change in scope updates `DECISIONS.md` **and** every affected document in the same change.
- A new requirement gets an ID in `REQUIREMENTS.md` and a row in `TRACEABILITY.md` **before** implementation.
- A resolved open question moves from `OPEN-QUESTIONS.md` to `DECISIONS.md` — never silently deleted.
- Documents must not contradict one another. If they do, the hierarchy in `AI-CONTEXT.md` §12 decides, and the loser is corrected.
