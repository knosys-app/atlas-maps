#!/usr/bin/env node
/**
 * Plugin publish script — automates the per-change release flow.
 *
 * For each invocation:
 *   1. Verify clean main + up-to-date with origin.
 *   2. Resolve the next version (`3.0.0-alpha.N` with auto-incrementing N).
 *   3. Bump version in package.json + manifest.json (working-dir only —
 *      not committed to main, so branch protection doesn't matter).
 *   4. Build the plugin (npm run build).
 *   5. Pack into a tarball via `npm pack` (matches the file list in
 *      package.json: manifest, main.js, styles.css, README, LICENSE).
 *   6. Compute SHA256 of the tarball.
 *   7. Tag the current HEAD as `v<version>` and push the tag.
 *   8. `gh release create` with the tarball attached and auto-generated
 *      release notes from `git log` since the previous tag.
 *   9. Clone community-plugins to a temp dir, patch index.json's
 *      knosys-maps entry, push a branch, open a DRAFT PR (so you can
 *      review the diff before flipping it ready + merging).
 *  10. Revert working-dir changes so the user's repo is clean.
 *
 * Versioning: `3.0.0-alpha.N` for the v3 pre-release ramp. The host's
 * plugin updater uses semver comparison — every alpha bumps cleanly
 * over the previous, and any alpha is newer than `2.1.0`.
 *
 * Index PR: draft-mode so you confirm the index.json diff before
 * pushing to all Browse Store consumers. The PR title is
 * `bump(knosys-maps): vPREV → vNEXT` for easy scanning.
 *
 * Flags:
 *   --dry-run         Do everything except remote side effects (tag push,
 *                     gh release create, gh pr create). For verifying
 *                     the script without polluting GitHub state.
 *   --skip-build      Reuse the existing main.js. Faster iteration when
 *                     you're testing the script itself.
 *
 * Requirements:
 *   - gh CLI authenticated for both atlas-maps and community-plugins
 *     (`gh auth status` should pass for both).
 *   - Clean working tree on main.
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PLUGIN_ID = 'knosys-maps'
const REGISTRY_REPO = 'knosys-app/community-plugins'
const VERSION_BASE = '3.0.0'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const skipBuild = args.includes('--skip-build')

// ---------- Shell helpers ----------

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit', cwd: opts.cwd })
}

function shCapture(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd }).trim()
}

function shTry(cmd, opts = {}) {
  try {
    return shCapture(cmd, opts)
  } catch {
    return ''
  }
}

function fail(msg) {
  // Throw rather than process.exit so the outer try/finally in
  // main() runs `restoreFiles` — otherwise a failure after
  // bumpVersion leaves package.json/manifest.json bumped in the
  // working tree, AND the openIndexPR temp clone leaks.
  throw new Error(msg)
}

function step(msg) {
  console.log(`\n→ ${msg}`)
}

function info(msg) {
  console.log(`  ${msg}`)
}

// ---------- Phases ----------

function verifyGh() {
  step('Verifying gh CLI auth')
  const status = shTry('gh auth status')
  if (!status) fail('gh CLI is not authenticated. Run `gh auth login`.')
  info('gh authenticated')
}

function verifyClean() {
  step('Verifying git state')
  const branch = shCapture('git rev-parse --abbrev-ref HEAD')
  if (branch !== 'main') {
    if (dryRun) {
      info(`(dry-run: allowing non-main branch ${branch} for testing)`)
    } else {
      fail(`Must be on main (currently on ${branch})`)
    }
  }

  // Refresh remote refs so the up-to-date check reflects what's on
  // origin right now. Skipped in dry-run so the script can be tested
  // offline.
  if (!dryRun) sh('git fetch origin main', { silent: true })

  // Check for modified or staged tracked files only — untracked
  // files (like a local tarball, IDE scratch, or files the user is
  // planning to add) shouldn't block a release. `git diff --quiet`
  // exits 0 when no diff for tracked files; checked separately for
  // worktree and index so a staged-but-unmodified-worktree state
  // still trips the guard.
  const unstaged = shTry('git diff --quiet || echo dirty')
  const staged = shTry('git diff --cached --quiet || echo dirty')
  if (unstaged || staged) {
    fail('Tracked files have uncommitted changes. Commit or stash first.')
  }

  const localHead = shCapture('git rev-parse HEAD')
  if (!dryRun) {
    const remoteHead = shTry('git rev-parse origin/main')
    if (remoteHead && localHead !== remoteHead) {
      fail(`Local main is behind origin (run \`git pull\` first)`)
    }
  }

  info(`HEAD at ${localHead.slice(0, 7)}`)
}

function nextVersion() {
  step('Resolving next version')
  const tagList = shTry(`gh release list --limit 100 --json tagName -q ".[].tagName"`)
  const releases = tagList ? tagList.split('\n').filter(Boolean) : []
  const prefix = `v${VERSION_BASE}-alpha.`
  const counts = releases
    .filter((t) => t.startsWith(prefix))
    .map((t) => parseInt(t.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n))
  const next = counts.length === 0 ? 1 : Math.max(...counts) + 1
  const latest = counts.length === 0 ? 'none' : `alpha.${Math.max(...counts)}`
  const v = `${VERSION_BASE}-alpha.${next}`
  info(`Next: v${v} (latest existing alpha: ${latest})`)
  return v
}

function verifyTagAvailable(version) {
  const tag = `v${version}`
  const exists = shTry(`gh release view ${tag} --json tagName -q .tagName`)
  if (exists) fail(`Release ${tag} already exists. Bump the alpha counter or delete it first.`)
}

function bumpVersion(version) {
  step(`Bumping version → ${version}`)
  for (const file of ['package.json', 'manifest.json']) {
    const json = JSON.parse(readFileSync(file, 'utf8'))
    json.version = version
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
  }
  info('package.json + manifest.json updated (working-dir only)')
}

function build() {
  if (skipBuild) {
    step('Build skipped (--skip-build)')
    if (!existsSync('main.js')) fail('main.js missing — cannot --skip-build')
    return
  }
  step('Building plugin')
  sh('npm run build')
  if (!existsSync('main.js')) fail('Build did not produce main.js')
}

function pack(version) {
  step('Packing tarball')
  const expected = `${PLUGIN_ID}-${version}.tgz`
  shCapture('npm pack --silent --pack-destination .')
  if (existsSync(expected)) {
    info(`Tarball: ${expected}`)
    return expected
  }
  // npm sometimes sanitises pre-release identifiers in filenames.
  // Find whatever it produced and rename to the canonical form.
  const candidates = readdirSync('.').filter(
    (n) => n.startsWith(`${PLUGIN_ID}-`) && n.endsWith('.tgz'),
  )
  if (candidates.length === 0) fail('npm pack did not produce a tarball')
  // Pick the most-recent by mtime to avoid grabbing a stale
  // leftover. Lexicographic sort wouldn't work past alpha.9 —
  // `knosys-maps-3.0.0-alpha.10.tgz` sorts before `…alpha.9.tgz`
  // alphabetically because '1' < '9', so a stale leftover at
  // double-digit alphas would silently shadow the freshly-packed
  // one and end up in the release.
  candidates.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  const actual = candidates[candidates.length - 1]
  if (actual !== expected) {
    sh(`mv "${actual}" "${expected}"`, { silent: true })
  }
  info(`Tarball: ${expected}`)
  return expected
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function tagAndPush(version) {
  const tag = `v${version}`
  step(`Tagging + pushing ${tag}`)
  if (dryRun) {
    info('(dry-run: skipping git tag + push)')
    return
  }
  sh(`git tag ${tag}`)
  sh(`git push origin ${tag}`)
  info(`Pushed ${tag}`)
}

function generateNotes(version) {
  // Find the previous tag for the diff range. Excludes the tag we
  // just created (or are about to in dry-run) so the changelog isn't
  // empty. `-vxF` = invert + whole-line + fixed-string: -x prevents
  // `v3.0.0-alpha.1` matching as a substring of `v3.0.0-alpha.10`,
  // and -F avoids interpreting `.` as a regex wildcard.
  const previous = shTry(
    `git tag --sort=-creatordate --list "v*" | grep -vxF "v${version}" | head -1`,
  )
  let notes = `Plugin release v${version}.\n`
  if (previous) {
    const log = shTry(`git log --oneline ${previous}..HEAD --no-merges`)
    if (log) {
      const bullets = log
        .split('\n')
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join('\n')
      notes += `\n## Changes since ${previous}\n\n${bullets}\n`
    } else {
      notes += `\n_No new commits since ${previous}; release artifact rebuilt against the same source._\n`
    }
  }
  notes += `\n## Install\n\nUpdate in Knosys via Settings → Plugins → Browse Store.\n`
  return notes
}

function createRelease(version, tarball) {
  const tag = `v${version}`
  step('Creating GitHub release')
  if (dryRun) {
    info('(dry-run: skipping gh release create)')
    info(`Would attach: ${tarball}`)
    return `https://github.com/knosys-app/atlas-maps/releases/tag/${tag}`
  }
  const notes = generateNotes(version)
  const notesFile = '.release-notes.md'
  writeFileSync(notesFile, notes)
  try {
    sh(`gh release create ${tag} --title "${tag}" --notes-file ${notesFile} "${tarball}"`)
  } finally {
    if (existsSync(notesFile)) rmSync(notesFile)
  }
  const url = shCapture(`gh release view ${tag} --json url -q .url`)
  info(`Release: ${url}`)
  return url
}

function openIndexPR(version, tarball, sha) {
  step('Opening community-plugins index PR')
  if (dryRun) {
    info('(dry-run: skipping community-plugins clone + PR)')
    info(`Would set:\n    version: ${version}\n    downloadSha256: ${sha}`)
    return `https://github.com/${REGISTRY_REPO}/pulls`
  }

  const downloadUrl = `https://github.com/knosys-app/atlas-maps/releases/download/v${version}/${tarball}`
  const tmpDir = join(tmpdir(), `community-plugins-${Date.now()}`)

  try {
    sh(`gh repo clone ${REGISTRY_REPO} "${tmpDir}" -- --depth=1`, { silent: true })

    const indexPath = join(tmpDir, 'index.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    const entry = index.plugins.find((p) => p.id === PLUGIN_ID)
    if (!entry) fail(`No ${PLUGIN_ID} entry in registry index.json`)

    const prevVersion = entry.version

    entry.version = version
    entry.knosysApi = 3
    entry.downloadUrl = downloadUrl
    entry.downloadSha256 = sha
    entry.description =
      'Offline driving navigation — routes (v3.0), turn-by-turn + GPS (v3.1+).'
    entry.permissions = [
      'storage',
      'network',
      'vault:read',
      'vault:write',
      'sqlite:read',
      'sqlite:write',
      'routing:engine',
    ]
    // v3 doesn't need MapTiler — drop the v2.1 API key declaration.
    delete entry.requiredApiKeys

    writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')

    // `git commit` reads user.name/user.email from the local repo
    // config first, then global. A fresh clone has no local config,
    // so on a dev box or CI runner without global identity set
    // `git commit` would die with "Author identity unknown." Pull
    // the host's global identity (if any) into the local config of
    // the temp clone; fall back to a bot identity so the commit
    // succeeds even on a pristine machine.
    const userName = shTry('git config --global user.name') || 'Knosys Release'
    const userEmail = shTry('git config --global user.email') || 'release@knosys.app'
    sh(`git config user.name "${userName}"`, { cwd: tmpDir, silent: true })
    sh(`git config user.email "${userEmail}"`, { cwd: tmpDir, silent: true })

    const branch = `bump-knosys-maps-${version}`
    sh(`git checkout -b "${branch}"`, { cwd: tmpDir, silent: true })
    sh(`git add index.json`, { cwd: tmpDir, silent: true })
    sh(
      `git commit -m "bump(knosys-maps): ${prevVersion} → ${version}"`,
      { cwd: tmpDir, silent: true },
    )
    sh(`git push -u origin "${branch}"`, { cwd: tmpDir, silent: true })

    const body =
      `Bumps \`knosys-maps\` from \`${prevVersion}\` to \`${version}\`.\n\n` +
      `Release: https://github.com/knosys-app/atlas-maps/releases/tag/v${version}\n` +
      `SHA256: \`${sha}\`\n\n` +
      `🤖 Generated by \`scripts/publish.mjs\` in atlas-maps. ` +
      `Auto-created as draft — review the index.json diff, mark ready, and merge.`

    // Use --body-file so multi-line markdown doesn't get mangled by
    // shell quoting on every platform.
    const bodyFile = join(tmpDir, '.pr-body.md')
    writeFileSync(bodyFile, body)
    const prUrl = shCapture(
      `gh pr create --draft ` +
        `--title "bump(knosys-maps): ${prevVersion} → ${version}" ` +
        `--body-file "${bodyFile}"`,
      { cwd: tmpDir },
    )
    info(`Index PR (draft): ${prUrl}`)
    return prUrl
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function restoreFiles(tarball) {
  step('Cleaning up')
  // Drop the local tarball — the release has it now.
  if (tarball && existsSync(tarball)) {
    rmSync(tarball)
    info(`Removed ${tarball}`)
  }
  // Revert working-dir mutations so the user's repo is clean. main.js
  // is restored to its committed state; if the user wants the latest
  // build, they re-run `npm run build`.
  const dirty = shTry('git status --porcelain')
  if (dirty) {
    sh('git checkout -- package.json manifest.json main.js', { silent: true })
    info('Reverted version bumps in working tree')
  }
}

// ---------- Main ----------

async function main() {
  if (dryRun) console.log('(DRY RUN — no remote side effects)\n')

  verifyGh()
  verifyClean()
  const version = nextVersion()
  if (!dryRun) verifyTagAvailable(version)

  let tarball = null
  try {
    bumpVersion(version)
    build()
    tarball = pack(version)
    const sha = sha256(tarball)
    info(`SHA256: ${sha}`)

    tagAndPush(version)
    const releaseUrl = createRelease(version, tarball)
    const prUrl = openIndexPR(version, tarball, sha)

    step('Done')
    console.log(`\n✓ Released v${version}`)
    console.log(`  Release: ${releaseUrl}`)
    console.log(`  Index PR: ${prUrl}`)
    console.log(`\nNext: review the draft PR → mark ready → merge.`)
    console.log(`Then: Knosys → Settings → Plugins → Browse Store → Update.`)
  } finally {
    restoreFiles(tarball)
  }
}

main().catch((err) => {
  // `fail()` throws Error(msg); print the message in the same
  // `✗ ...` format the early process.exit version used. Stack
  // traces only useful for unexpected exceptions — guard by
  // checking for the `Error` shape we throw.
  if (err instanceof Error && err.message) {
    console.error(`\n✗ ${err.message}`)
  } else {
    console.error(err)
  }
  process.exit(1)
})
