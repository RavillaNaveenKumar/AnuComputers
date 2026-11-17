# GemNava CRM

A self-hosted internal workspace for customer relationships, sales follow-up, quotations, orders, dispatch, serial/warranty history, and service tickets. It uses Next.js, TypeScript, PostgreSQL, Prisma, and local email/password authentication. Customer and business data stays in the PostgreSQL database you operate.

## Requirements

- Node.js 20.19+ (Node.js 22 LTS recommended)
- npm (included with Node.js)
- Docker Desktop for the local PostgreSQL option, or an existing PostgreSQL 15+ server

## Local setup (Windows PowerShell)

Run these commands from the project directory:

```powershell
Copy-Item .env.example .env
```

Edit `.env`. Set a unique secret (at least 32 characters) and a private development Admin password of at least 12 characters. For example, generate a secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The sample `.env` connection string works with the included Docker Compose database. For a real installation, replace every example password and secret.

To preview the interface without starting a database, set `PREVIEW_MODE="true"` in `.env`, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` to local preview credentials, and run `npm.cmd run dev`. Sign in with those values to browse the Dashboard, Leads, Customers, Products, Quotes, Orders, Service, Settings, and CRM Setup screens. CRM Setup lets you create custom objects, typed fields, picklists, record layouts, and lookup, master-detail, and one-to-one relationships to custom or standard demo objects. Add custom records to try the layouts and relationships. Demo definitions and records are saved in this browser's local storage only. Preview mode does not connect to PostgreSQL, share records with other devices, or enable the CRM data APIs. Disable it before normal use by setting `PREVIEW_MODE="false"` and configuring PostgreSQL; browser-demo custom objects are not automatically migrated to the shared database.

### Database-backed CRM Setup

With preview mode disabled and PostgreSQL migrations applied, Administrators can open **CRM Setup** to manage the shared object registry, custom objects, custom fields, relationships, Sales and Service applications, page layouts, users, Profiles, Permission Sets, organizational Roles & Hierarchy, Sharing Rules, Login History, Audit Logs, and Effective Permissions. Profiles provide baseline app, object CRUD, field-level, tab, and login permissions. Permission Sets provide additive app, object, field, and tab grants without replacing Profile permissions. Built-in application access roles (Sales Executive, Sales Manager, Service Agent, Technician, Dispatch, and Administrator) continue to be enforced by server-side capability checks. The obsolete Access Roles assignment screen was removed because its legacy role-assignment table did not participate in authorization; legacy database tables are retained for compatibility. Organizational hierarchy roles are separate from application access roles and Profiles, and sharing rules can use the hierarchy to grant record access. Record sharing supports per-object defaults, parent-controlled lookup access, owner/criteria rules, optional hierarchy grants, and manual user shares for registry-backed objects and the native Account, Contact, Lead, Product, Quote, Quote Line Item, Order, Order Item, Case, and Case Comment stores. Sharing configuration is managed in CRM Setup, with per-record share controls on supported CRM record views. The built-in profiles include System Administrator, Sales Manager, Sales User, Service Manager, Service User, Technician, and Dispatch (to preserve the existing dispatch account type). Existing typed database models provide record storage for Accounts/Customers, Contacts, Leads, Products, Quotes, Quote Line Items, Orders, Order Items, Cases/Service Tickets, and Case Comments/Ticket Updates. Other standard objects use shared `crm_records` storage and the generic record screens rather than dedicated typed business tables.

Before running the migration commands below on an existing database, create a PostgreSQL backup and verify it by restoring into a separate, empty test database. Do not test restoration against the live database. For example, with PostgreSQL client tools installed and private connection strings configured in the current PowerShell session:

```powershell
$sourceDatabaseUrl = "postgresql://anu:PRIVATE_PASSWORD@localhost:5432/anu_crm"
$restoreTestDatabaseUrl = "postgresql://anu:PRIVATE_PASSWORD@localhost:5432/anu_crm_restore_check"
pg_dump --format=custom --file=.\anu-crm-backup.dump "$sourceDatabaseUrl"
createdb --maintenance-db="$sourceDatabaseUrl" anu_crm_restore_check
pg_restore --exit-on-error --no-owner --dbname="$restoreTestDatabaseUrl" .\anu-crm-backup.dump
psql "$restoreTestDatabaseUrl" --command='SELECT COUNT(*) FROM "_prisma_migrations";'
```

Confirm the restore command succeeds and the restored database contains the expected application schema and records before continuing. Keep the backup according to your retention policy. The restore-test database can be removed after validation with `dropdb --maintenance-db="$sourceDatabaseUrl" anu_crm_restore_check`; confirm the exact database name before doing so. Never run `pg_restore --clean` against the live database as a backup test.

After verifying the backup restore, apply the additive migrations and explicitly run the seed to register standard objects, default application navigation, relationships, layouts, CRM roles, Profiles, and initial grants:

```powershell
npm.cmd run db:deploy
npm.cmd run db:seed
```

The migrations add security metadata, Profile assignments, default hierarchy roles and user assignments, Permission Set tables, additive registry-sharing metadata, and the object-field lifecycle columns/counter/actor sidecar; they do not edit or delete existing CRM business rows. Existing users are mapped to matching built-in Profiles and hierarchy roles without changing their CRM access roles. The seed is idempotent and adds registry configuration. In production, the seed still skips fictional business demo records. CRM Setup REST routes are under `/api/crm-setup/` and require an active Admin session, including `profiles`, `permission-sets`, `role-hierarchy`, `role-hierarchy/roles`, `role-hierarchy/assignments`, `users`, `objects`, `objects/:id`, `objects/:id/fields`, `relationships`, `apps`, `apps/:id`, `layouts/:objectId`, `sharing/:objectId`, and `sharing/:objectId/rules`. Browser-preview mode continues to use its isolated local-storage demo and blocks these APIs.

Registry-backed record APIs enforce effective Profile plus Permission Set app/object grants and field access, and audit changes. Permission Set grants are combined additively; Profile-hidden tabs remain hidden, auto-number fields remain read-only, and account/profile login restrictions cannot be overridden by a Permission Set. Registry-backed records now receive an owner on creation, and record reads/updates/deletes honor object defaults, hierarchy grants, owner/criteria rules, parent-controlled lookup access, and manual shares. The additive record-sharing migration creates PUBLIC_READ_WRITE configs for existing CRM objects to preserve current visibility and gives newly created objects PRIVATE defaults; existing records are not assigned inferred owners. Before changing an existing object's default to PRIVATE, assign owners or explicit shares to its legacy unowned records. New sharing features require applying the migration after a verified backup restore. The native CRM record adapter now applies the same sharing policy to the listed native Sales and Service stores; direct business API lists and server-rendered list/detail queries use its accessible record set, while mutation routes check record access before changing records and retain workflow/assignment invariants. Related Account, Product, Order, and Quote references shown in server-rendered views are filtered through accessible record IDs. Sharing configuration and rule APIs are available under `/api/crm-setup/sharing/:objectId`, and manual record shares use `/api/crm-records/:objectId/shares`; supported CRM record views provide per-record share controls. Imports accept either a JSON array of field-value objects or the exported file format and are limited to 500 records per request. Native field-level checks cover primary Sales and Service APIs, global search, shipment workflows, customer address creation, and lead activity notes. Address columns are grouped under `Account.AddressDetails`; shipments and purchased units are operational child rows and do not have independent sharing or field-level policies.

The Sharing Rules Setup screen manages object defaults and owner/criteria rules through `/api/crm-setup/sharing/:objectId`; Login History, Audit Logs, and Effective Permissions use `/api/crm-setup/login-history`, `/api/crm-setup/audit-logs`, and `/api/crm-setup/effective-permissions`. Manual record shares use `/api/crm-records/:objectId/shares`; supported record views expose owner/admin share controls.

### Object and field lifecycle

The additive object-field lifecycle migration provisions protected `Id`, `CreatedById`, `CreatedDate`, `LastModifiedById`, and `LastModifiedDate` fields, plus optional `OwnerId` and `SystemModstamp`, through the shared CRM registry. Registry-backed record APIs derive these values from server/database state, reject attempts to submit them, and store creator/modifier IDs as references to CRM users. New custom objects default to an editable, required Text `Name` field (80 characters); administrators can instead configure a read-only Auto Number Name with prefix, suffix, starting number, and minimum digit count. Number allocation uses a transactional PostgreSQL counter. Auto Number fields added later are limited to objects with no records so existing data is not silently rewritten.

Native Sales and Service rows keep their existing typed business tables. The CRM Object Manager and legacy business APIs stamp creator/modifier metadata in the shared sidecar; historical native rows are not assigned inferred creator IDs. Contacts expose editable `FirstName` and `LastName` fields with a read-only compound `Name`; Cases expose the generated `CaseNumber` and editable `Subject` while retaining the existing typed `ServiceTicket.title` column internally. Native Contact, Quote Line Item, and Order Item rows have their own timestamps. All standard objects have registry-backed metadata and the generic CRM records screen; objects without an existing typed business model store their records in `crm_records`.

The requested cleanup of existing CRM business records is a separate, explicit operation; applying the additive migration alone does not delete records. First create a fresh backup and verify a successful restore in a separate database. Review the target and counts with the dry run:

```powershell
npm.cmd run db:purge-business-data
```

Only after verifying the backup restore and confirming that the displayed target database is correct, set `CRM_PURGE_TARGET_DATABASE` to that exact database name, `CRM_PURGE_BACKUP_RESTORE_VERIFIED=true`, and `CRM_PURGE_CONFIRMATION=DELETE_ALL_CRM_BUSINESS_DATA` in the current PowerShell session, then run:

```powershell
npm.cmd run db:purge-business-data -- --execute
```

The purge transaction removes native and registry CRM business records, related transactional rows, product categories, native field values, shares, and idempotency records. It preserves users, authentication/session data, CRM object/field configuration, Profiles, Permission Sets, roles, sharing configuration, auto-number counters, login history, and audit history. It records the purge in `CrmAuditLog`. Never run it against a database unless the target and backup restore have been verified.

The PostgreSQL persistence tests are opt-in and must use a dedicated, disposable database, never the application or production database. Create that database, then point `DATABASE_URL` to it while running `npm.cmd run db:deploy` and `npm.cmd run db:seed`. Restore the normal application `DATABASE_URL`, set `SECURITY_TEST_DATABASE_URL` to the dedicated database URL, and run `npm.cmd run test:security-integration`. The test checks that this URL differs from the application URL before connecting; it creates and removes only uniquely named test users, sessions, and audit events. Do not run these commands against a database containing business records.

### PostgreSQL with Docker Desktop

The bundled PostgreSQL container listens on host port `5433`, avoiding a conflict with an existing PostgreSQL service using the default port `5432`. Start the local database:

```powershell
docker compose up -d postgres
```

Wait until it is healthy:

```powershell
docker compose ps
```

### Existing PostgreSQL installation

Create a database and login role using your PostgreSQL administrator, then change `DATABASE_URL` in `.env`:

```sql
CREATE ROLE anu WITH LOGIN PASSWORD 'replace-with-a-private-password';
CREATE DATABASE anu_crm OWNER anu;
```

The connection URL format is:

```text
postgresql://anu:replace-with-a-private-password@localhost:5432/anu_crm?schema=public
```

### Install, migrate, and seed

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run db:seed
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env`. The development seed is repeatable and creates fictional sample data for:

- Bluebell Design Studio's enquiry for 10 laptops
- An accepted quotation and related order
- A partial delivery of 6 serialized laptops, with six purchased units
- A service ticket linked to one purchased serial
- A delivered quantity-tracked IC order

You can add staff accounts and assign roles in **Settings**. Public sign-up is disabled.

## Production and first Admin

Do not use the example credentials or seed demo records in production. Provision a private PostgreSQL database, set a randomly generated `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` to the canonical HTTPS origin, a restricted `DATABASE_URL`, and a temporary `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Apply the migrations, then bootstrap only the Admin account by running the seed in production mode:

```powershell
$env:NODE_ENV = "production"
npm.cmd run db:deploy
npm.cmd run db:seed
Remove-Item Env:NODE_ENV
```

In production mode, the seed creates or verifies only the configured Admin and skips all fictional demo records. Store the bootstrap password in an approved secret manager, sign in once, and rotate it using the account credential-management process before giving the account to staff. Keep at least one active Admin.

Build and run the app behind your organization’s private network and HTTPS reverse proxy:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run build
npm.cmd start
```

The production build output is stored in `.next-deploy` so builds work reliably in OneDrive-synced Windows workspaces where `.next` may contain cloud reparse points.

For a local production-mode process that rebuilds and restarts after source/configuration changes, first rotate any credentials that have been shared, verify a database backup by restoring it to a separate database, and then apply `db:deploy` and `db:seed` as described above. Start the local watcher with `npm.cmd run deploy:local`. It binds only to `127.0.0.1`, debounces changes, and writes server logs to the ignored `.local-deploy` directory. It does not run migrations or seeds automatically; review and apply database changes manually after a verified backup. Press Ctrl+C to stop the watcher and its server.

The app listens on port `3000` by default. Do not expose it directly to the public internet. Restrict PostgreSQL network access to the application, use TLS for browser access, and rotate application/database secrets according to your operations policy.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by Prisma |
| `BETTER_AUTH_SECRET` | Secret used to protect authentication sessions; keep private and sufficiently random |
| `BETTER_AUTH_URL` | App origin, e.g. `http://localhost:3000` locally or the HTTPS origin in production |
| `SEED_ADMIN_EMAIL` | Email for the first local development Admin or production bootstrap |
| `SEED_ADMIN_PASSWORD` | Password for the initial Admin; at least 12 characters |
| `BUSINESS_TIMEZONE` | Default display timezone; `Asia/Kolkata` by default |

Settings also store the business timezone and default future product warranty. Warranty dates already saved on purchased units are not recalculated when product policies change. Delivery date is the default warranty start date.

## Useful commands

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run deploy:local
npm.cmd run db:studio
npm.cmd run db:deploy
```

The initial PostgreSQL schema is checked in under `prisma/migrations`. Use `npm.cmd run db:deploy` to apply checked-in migrations on a new installation or deployment. `npm.cmd run db:migrate -- --name <change-name>` creates and applies later development migrations.

## Demo walkthrough

1. Sign in as the configured development Admin.
2. Open **Leads** and inspect the qualified Bluebell Design Studio laptop enquiry.
3. Open **Quotations** and view `QUO-DEMO-001`; print view is available from the quotation detail.
4. Open **Orders** and inspect `ORD-DEMO-001`: 10 ordered, 6 dispatched and delivered, 4 pending.
5. Open **Customers → Bluebell Design Studio → Purchased products** to see six serials and warranty dates.
6. Open **Service** and inspect `TKT-DEMO-001`. A second order shows delivery of 50 quantity-tracked ICs without serial capture.
7. Add a staff account with a role in **Settings** to exercise role-scoped views and actions.

## Data, security, and operational notes

- Password credentials are hashed by Better Auth; sessions and user records are persisted in PostgreSQL. Session cookies are managed by the auth library. Public registration is disabled.
- CRM app/object permissions and field filtering are enforced on the server for registry-backed and native CRM record APIs, combining Profile grants with assigned Permission Set grants. Native Sales and Service record lists and detail pages now apply record-sharing policy, and mutation APIs check record access; related operational rows inherit access from their CRM parent and are not independently shareable. UI visibility is not the authorization boundary.
- A centralized evaluator distinguishes unauthenticated API requests (401) from authenticated-but-denied requests (403) and is used by protected CRM Setup and business APIs, plus server-rendered CRM record pages. Field-level checks cover registry-backed records and primary native Sales and Service APIs, global search, shipment workflows, customer address creation, and lead activity notes. Address columns share one FLS control, and operational rows such as purchased units and shipments have no independent sharing or field-level policy. Workflow and assignment checks remain in place.
- Role capabilities are enforced on the server. Read access is scoped as described below; write actions require the corresponding capability.

| Role | Customers | Products | Leads | Quotes | Orders | Dispatch | Service | Staff / settings |
|---|---|---|---|---|---|---|---|---|
| Admin | Read / write | Read / write | Read / write / assign | Read / write | Read / write | Manage | Read / write / assign | Manage |
| Sales Manager | Read / write | Read | Read / write / assign | Read / write | Read / write | — | — | — |
| Sales Executive | Read / write (owned / related) | Read | Read / write (assigned) | Read / write (owned / related) | Read / write (owned / related) | — | — | — |
| Dispatch | Read in dispatch workflows | — | — | — | Read (without sales pricing) | Manage | — | — |
| Service Agent | Read | Read | — | — | Read | — | Read / write / assign | — |
| Technician | Read | Read | — | — | — | — | Read / write (assigned tickets) | — |

- Quote/order totals are calculated on the server in integer paise and persisted as PostgreSQL `Decimal` values. An accepted quote has a unique order relation; repeat/concurrent order requests return the existing order.
- Delivery is tracked per shipment line. Delivery requests require an idempotency key; serials are normalized for uniqueness per product. Quantity-tracked products do not require serials.
- Important quote, order, delivery, lead conversion, ticket closure, and replacement actions are audited. Audit records omit credentials and session tokens.
- Back up PostgreSQL regularly and verify restoration against a separate, empty test database before applying migrations. Example:

```powershell
$sourceDatabaseUrl = "postgresql://anu:PRIVATE_PASSWORD@localhost:5432/anu_crm"
$restoreTestDatabaseUrl = "postgresql://anu:PRIVATE_PASSWORD@localhost:5432/anu_crm_restore_check"
pg_dump --format=custom --file=.\anu-crm-backup.dump "$sourceDatabaseUrl"
createdb --maintenance-db="$sourceDatabaseUrl" anu_crm_restore_check
pg_restore --exit-on-error --no-owner --dbname="$restoreTestDatabaseUrl" .\anu-crm-backup.dump
psql "$restoreTestDatabaseUrl" --command='SELECT COUNT(*) FROM "_prisma_migrations";'
```

Never restore a test backup with `--clean` into the live database. Replace the placeholder password privately and keep the dump in a protected location.

## Validation

Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build`. Database migration/seed validation requires a reachable PostgreSQL instance; the browser acceptance flows require running the app with that database.
