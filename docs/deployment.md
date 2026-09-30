# Production deployment

Live URL: <https://buttery.wtf/rollerball/>. Node.js 22+ is required.

## Ownership

The production transport serves compiled files only. `server/app.mjs` owns HTTP
file handling, tested beside it in `server/app.test.mjs`; `server/static-server.mjs`
owns the listener lifecycle. Neither imports application or simulation modules.
`src/routes/+layout.ts` enables prerendering; the SvelteKit configuration owns
`VITE_BASE_PATH`. Existing local dev/preview/test ports remain unchanged.

`scripts/deploy.sh` owns deployment and rollback; `scripts/deploy-remote.mjs`
invokes it over SSH. `ecosystem.config.cjs` owns only this app's PM2 process.
This adds a production HTTP entry point without changing simulation contracts,
dependency directions, module thresholds, or subsystem capacity.

## Routine deployment

Run the full repository quality gate before committing. Also run `npm test`, `npm run test:server` and `npm run build`.
Push the intended production commit to `main`, then run:

```sh
npm run deploy
```

The command uses the existing `hetzner-server` SSH alias. Alternatively, on the VPS:

```sh
sudo -u flamehorn -H bash -c 'cd /home/flamehorn/rollerball && npm run deploy:production'
```

Production runs as `flamehorn` with `PM2_HOME=/home/flamehorn/.pm2`, binds only to
`127.0.0.1:4006`, and uses the `rollerball` process. The public repository
is cloned over HTTPS; no private key or credentials belong in this repository.

Deployment refuses a dirty/diverged checkout or a branch other than `main`.
It installs dependencies and runs `check:production` (types, headless tests,
HTTP/deployment checks, and the prefixed production build) in a temporary checkout.
The browser-inclusive local quality gate remains required before publication.
It backs up source and the previous build outside Git at
`/home/flamehorn/rollerball-backups/`, then fast-forwards, publishes assets,
atomically replaces HTML, reloads only this PM2 process and verifies its HTML.
A failure attempts to restore the previous source/build. Older hashed assets
remain available for visitors with open tabs. Inspect the printed backup if recovery fails.
Normal rollback is a Git revert on `main`, followed by another deployment.

## One-time server setup

Clone into `/home/flamehorn/rollerball` as `flamehorn`, then run
`npm run deploy:production`. Confirm port 4006 is unused first.
Add only this route to the existing `buttery.wtf, www.buttery.wtf` Caddy block:

```caddyfile
redir /rollerball /rollerball/ 308
handle_path /rollerball/* {
    reverse_proxy 127.0.0.1:4006
}
```

Back up `/etc/caddy/Caddyfile`, validate it with `caddy validate`, and reload Caddy.
Do not regenerate the shared configuration. Routine deployments do not edit Caddy.
`pm2 save` persists the new process in the existing user's startup service.

The production build uses SvelteKit's
[static adapter](https://svelte.dev/docs/kit/adapter-static) with
[paths.base](https://svelte.dev/docs/kit/configuration#paths) set to
`/rollerball`; Caddy strips this prefix before forwarding requests.
