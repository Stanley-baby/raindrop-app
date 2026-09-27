# Self-hosting

This repository ships an independently operated bookmark service. The Worker
owns its own users and data; it does not proxy the original Raindrop service.

## 1. Prepare Cloudflare

Install Node 18 and Wrangler, then run `wrangler login`. Create one D1 database,
the `CONTENT_BUCKET` and `BACKUP_BUCKET` R2 buckets, and the task and dead-letter
queues in your account. For example:

```sh
npx wrangler d1 create raindrop-db-selfhosted
npx wrangler r2 bucket create raindrop-content-selfhosted
npx wrangler r2 bucket create raindrop-backup-selfhosted
npx wrangler queues create raindrop-tasks-selfhosted
npx wrangler queues create raindrop-tasks-dlq-selfhosted
```

Copy the public configuration template:

```sh
cp cloudflare/wrangler.toml cloudflare/wrangler.private.toml
```

Edit the `selfhosted` blocks in `cloudflare/wrangler.private.toml` with the D1
ID and resource names. Keep `RUNTIME_DOMAIN_MODE = "true"`, leave
`API_ORIGIN`, `APP_ORIGIN`, and `AI_PAGE_ORIGIN` empty, and keep
`CORS_ORIGINS = "chrome-extension://*"`; the Worker derives the Web origin from
the current request. Keep this file ignored and never put secrets in TOML. If
you choose different resource names, use the same names in the migration and
secret commands below.

Apply migrations and deploy:

```sh
npx wrangler d1 migrations apply raindrop-db-selfhosted --remote \
  --config cloudflare/wrangler.private.toml --env selfhosted
npx wrangler deploy --config cloudflare/wrangler.private.toml --env selfhosted
```

Set `SESSION_SECRET` and `ENCRYPTION_KEY` at minimum. Add `MAIL_FROM` and
`RESEND_API_KEY` for email verification; add Google, Apple, Turnstile, scanner,
or custom-provider secrets only when those features are enabled. Use the same
`--config` and `--env selfhosted` arguments with `wrangler secret put`.

## 2. Connect Pages to the API Worker

In the Cloudflare Pages project settings, add a Service binding with variable
name `API` and select the deployed `raindrop-api-selfhosted` Worker. Redeploy
Pages once after adding the binding. Pages routes API paths through this
binding while serving the application and static assets normally.

## 3. Build clients

The self-hosted Web bundle is domain-neutral. Build it without `API_ORIGIN`,
`APP_ORIGIN`, or `AI_PAGE_ORIGIN`, then attach the selected custom domain to
Pages. The same build works after changing that domain.

```sh
export REPOSITORY_URL=https://github.com/your-org/your-repo
export HELP_ORIGIN=https://github.com/your-org/your-repo
npm run build:selfhosted
```

The self-hosted extension has a runtime Options page. Build it without
`API_ORIGIN` or `APP_ORIGIN`; on first install enter the Web and API root
origins, grant the requested API host permission, and save. The values are
stored in `storage.sync`, so later domain changes do not require rebuilding the
extension.

```sh
npm run build:extension:selfhosted
```

The Web build is in `dist/web/selfhosted`. Chrome, Edge, Firefox, and Opera ZIPs
are written to `dist/*.zip`. When enabling OAuth, register the selected custom
domain callback URLs with each identity provider; updating their allowlists
does not require a client rebuild. `WORKERS_BASE_URL` is optional; when it is
empty, the client does not call the original image/render proxy.

## 4. Distribute without stores

Create a GitHub Release from a version tag such as `v5.8.1` and attach the Web
archive and extension ZIPs. Users deploy the Web files to their own static host
and load an extension ZIP in browser developer mode. Safari source remains
available for operators who choose to sign it themselves; no store credentials
are part of this project.

## 5. Upgrade and rollback

Pull a tagged release, review its migrations, apply them to the operator-owned
D1 database, and deploy the Worker. Keep the previous release tag available so
the Worker and client artifacts can be restored together if a deployment fails.

Contract coverage is the release gate:

```sh
npm run test:contract
npm run build:selfhosted
npm run build:extension:selfhosted
```

The MIT license and original attribution remain in `LICENSE.md`.

For the staging acceptance flow, run the email-secret wizard from the repository
root after the operator has verified a staging sender in Resend:

```sh
bash scripts/setup-selfhosted-staging-secrets.sh
```

The wizard ensures `SESSION_SECRET` and `ENCRYPTION_KEY` exist, then stores
`MAIL_FROM` and `RESEND_API_KEY` in the staging Worker secret store; it does
not write secret values to the repository or `.env`.

Use the canonical Pages URL for authenticated staging acceptance:
`https://raindrop-staging-20260907-web.pages.dev`. Pages deployment preview URLs
are static-only unless their origin is explicitly added to the staging
`CORS_ORIGINS` value; they are not the default API acceptance entry point.
