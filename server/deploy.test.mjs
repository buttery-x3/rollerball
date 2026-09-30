import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Exercise real Git histories on Linux. PM2, HTTP, identity and validation are
// replaced with fixtures so these checks never touch the running homepage.
test("deployment stages builds, preserves edits and rolls back failed publication", {
  skip: process.platform !== "linux" && "Deployment fixture runs on Linux",
  timeout: 30000,
}, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "buttery-deploy-test-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const author = path.join(fixture, "author");
  const checkout = path.join(fixture, "checkout");
  const remote = path.join(fixture, "remote.git");
  const bin = path.join(fixture, "bin");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: fixture,
    GIT_AUTHOR_NAME: "Deployment test", GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Deployment test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  const run = (command, args, cwd = fixture) => spawnSync(command, args, { cwd, env, encoding: "utf8" });
  const git = (cwd, ...args) => {
    const result = run("git", args, cwd);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  await mkdir(bin);
  for (const [name, body] of Object.entries({
    id: "echo flamehorn",
    npm: 'test ! -f "$FIXTURE/validation-fails" || exit 1\nmkdir -p build\ncp version.txt build/index.html\necho asset > build/new-asset.js',
    curl: 'test ! -f "$FIXTURE/health-fails" || exit 1\nwhile [ "$1" != "-o" ]; do shift; done\ncp build/index.html "$2"',
    pm2: 'echo "$*" >> "$FIXTURE/pm2-calls"\nif test -f "$FIXTURE/reload-fails"; then rm "$FIXTURE/reload-fails"; exit 1; fi',
    sleep: "exit 0",
  })) {
    const file = path.join(bin, name);
    await writeFile(file, `#!/bin/sh\n${body}\n`);
    await chmod(file, 0o755);
  }
  git(fixture, "init", "--bare", "--initial-branch=main", remote);
  git(fixture, "clone", remote, author);
  await mkdir(path.join(author, "scripts"));
  const deployScript = (await readFile(new URL("../scripts/deploy.sh", import.meta.url), "utf8"))
    .replaceAll("/home/flamehorn", fixture);
  await writeFile(path.join(author, "scripts/deploy.sh"), deployScript);
  await writeFile(path.join(author, "ecosystem.config.cjs"), "module.exports = {};\n");
  await writeFile(path.join(author, "version.txt"), "one\n");
  await writeFile(path.join(author, ".gitignore"), "build/\n");
  git(author, "add", ".");
  git(author, "commit", "-m", "Initial fixture");
  git(author, "push", "origin", "main");
  git(fixture, "clone", remote, checkout);
  const initial = git(checkout, "rev-parse", "HEAD");
  await mkdir(path.join(checkout, "build"));
  await writeFile(path.join(checkout, "build/index.html"), "one\n");
  await writeFile(path.join(checkout, "build/old-asset.js"), "old asset\n");
  await writeFile(path.join(author, "version.txt"), "two\n");
  git(author, "commit", "-am", "Next fixture");
  git(author, "push", "origin", "main");
  const target = git(author, "rev-parse", "HEAD");
  const deploy = () => run("bash", ["scripts/deploy.sh"], checkout);
  const requireReadIndex = () => readFileSync(path.join(checkout, "build/index.html"), "utf8");
  const expectFailure = (pattern) => {
    const result = deploy();
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, pattern);
    assert.equal(git(checkout, "rev-parse", "HEAD"), initial);
    assert.equal(requireReadIndex(), "one\n");
  };

  await writeFile(path.join(checkout, "version.txt"), "emergency server edit\n");
  expectFailure(/local changes/);
  assert.equal(await readFile(path.join(checkout, "version.txt"), "utf8"), "emergency server edit\n");
  git(checkout, "restore", "version.txt");

  await writeFile(path.join(fixture, "validation-fails"), "");
  const invalid = deploy();
  assert.notEqual(invalid.status, 0);
  assert.equal(git(checkout, "rev-parse", "HEAD"), initial);
  await rm(path.join(fixture, "validation-fails"));

  await writeFile(path.join(fixture, "reload-fails"), "");
  expectFailure(/Deployment failed; restoring/);
  assert.equal(await readFile(path.join(checkout, "version.txt"), "utf8"), "one\n");

  await writeFile(path.join(fixture, "health-fails"), "");
  expectFailure(/App health check failed/);
  await rm(path.join(fixture, "health-fails"));

  const success = deploy();
  assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`);
  assert.equal(git(checkout, "rev-parse", "HEAD"), target);
  assert.equal(git(checkout, "status", "--porcelain"), "");
  assert.equal(requireReadIndex(), "two\n");
  assert.equal(await readFile(path.join(checkout, "build/old-asset.js"), "utf8"), "old asset\n");
  assert.equal(await readFile(path.join(checkout, "version.txt"), "utf8"), "two\n");
  assert.match(await readFile(path.join(fixture, "pm2-calls"), "utf8"), /startOrReload/);

  await writeFile(path.join(checkout, "local.txt"), "server-only commit\n");
  git(checkout, "add", ".");
  git(checkout, "commit", "-m", "Diverged fixture");
  const diverged = git(checkout, "rev-parse", "HEAD");
  const refused = deploy();
  assert.notEqual(refused.status, 0);
  assert.match(`${refused.stdout}\n${refused.stderr}`, /diverged/);
  assert.equal(git(checkout, "rev-parse", "HEAD"), diverged);
});
