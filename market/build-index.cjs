#!/usr/bin/env node
/**
 * Generate market/index.json — a DSH plugin market index, format 1.
 *
 * The format is defined and validated by `@deepseek-ai/dsh-plugin-market-index`
 * (`parseMarketIndex`); see docs/market-index.md for the file:line evidence of
 * every rule.
 *
 * Authored display content lives in AUTHORED below; package facts (name, version,
 * keywords, homepage, repository, engines.dsh) are read from the root package.json,
 * so the index cannot drift from the release manifest.
 *
 * Install source (default): **git**, pinned to a commit that is already pushed, so the
 * entry never points at an unreachable commit. Resolution order:
 *   1. --commit <sha>
 *   2. `git ls-remote <remote> <remote-ref>`  (default origin refs/heads/main — preferred)
 *   3. local `git rev-parse HEAD`             (fallback, reported in the output)
 * The value and where it came from are always printed. An npm source is still supported
 * for use after the package is published (docs/market-index.md §2.1).
 *
 * Usage:
 *   node market/build-index.cjs                                   # git source, commit from origin/main
 *   node market/build-index.cjs --commit <40-hex-sha>             # pin an explicit commit
 *   node market/build-index.cjs --remote upstream --remote-ref refs/heads/release
 *   node market/build-index.cjs --source npm [--registry <url>]   # after npm publish
 *   node market/build-index.cjs --publish-timestamp <unix-seconds>
 *
 * Notes:
 *  - Format 1 has no plugin-level `license` member, so the Apache-2.0 license is
 *    declared by package.json only (unknown members are dropped by the validator).
 *  - `repository` is display-only in format 1; the install source is
 *    `versions[].source`, which must be `npm` (name@version) or `git` (commit-pinned).
 *  - Identical inputs produce byte-identical output (idempotency evidence in
 *    docs/market-index.md §4.2).
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const outFile = path.join(__dirname, 'index.json')

/** Authored display content: localized text objects must contain `en` (format rule). */
const AUTHORED = {
  indexTitle: { zh: 'dsh-browser-kit 插件索引', en: 'dsh-browser-kit plugin index' },
  indexDescription: {
    zh: '本索引发布 dsh-browser-kit：给 DSH Web GUI 增加页面级浏览器操作、元素批注与截图回传能力。',
    en: 'This index publishes dsh-browser-kit: page-level browser control, element annotation, and screenshot delivery for the DSH Web GUI.'
  },
  pluginTitle: { zh: 'DSH 浏览器增强套件', en: 'DSH Browser Kit' },
  pluginDescription: {
    zh: '元素批注（右键选元素、批注随消息交付给 Agent）、截图回传、设备尺寸模拟、凭据管理（仅本机、不进 Agent 上下文）、共享登录态窗口与 Agent 浏览器自动化。',
    en: 'Element annotation (right-click an element; the annotation reaches the agent with the message), screenshot delivery, device-size emulation, local-only credential management (never enters agent context), shared-login windows, and agent browser automation.'
  },
  author: 'Keysion Dev',
  category: 'browser',
  categories: {
    browser: { title: { zh: '浏览器', en: 'Browser' } }
  },
  labels: {
    annotation: { title: { zh: '元素批注', en: 'Annotations' } },
    screenshot: { title: { zh: '截图回传', en: 'Screenshots' } },
    'device-emulation': { title: { zh: '设备尺寸模拟', en: 'Device emulation' } },
    'credentials-local': { title: { zh: '凭据仅本机', en: 'Local-only credentials' } },
    automation: { title: { zh: '浏览器自动化', en: 'Browser automation' } }
  },
  pluginLabels: ['annotation', 'screenshot', 'device-emulation', 'credentials-local', 'automation']
}

const COMMIT = /^[0-9a-f]{40}$/u

function argOf (name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** Run git in the repository root; undefined when git is missing or the call fails. */
function git (args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return undefined
  }
}

/** Web URL of the repository, derived from package.json `repository.url`. */
function repositoryWebUrl (manifest) {
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  if (typeof raw !== 'string') throw new Error('package.json has no repository.url')
  const url = new URL(raw.replace(/^git\+/, '').replace(/\.git$/, ''))
  url.hash = ''
  url.search = ''
  return url.href
}

/**
 * The commit the git source pins: explicit, else the tip of a remote branch (already
 * pushed), else the local HEAD as a reported fallback.
 */
function resolveCommit (remoteName, remoteRef) {
  const explicit = argOf('--commit')
  if (explicit !== undefined) {
    if (!COMMIT.test(explicit)) throw new Error(`--commit must be a lowercase 40-hex SHA, got ${JSON.stringify(explicit)}`)
    return { commit: explicit, from: '--commit' }
  }
  const remoteLine = git(['ls-remote', remoteName, remoteRef])
  if (remoteLine !== undefined && remoteLine !== '') {
    const sha = remoteLine.split(/\s+/u)[0]
    if (!COMMIT.test(sha)) throw new Error(`git ls-remote ${remoteName} ${remoteRef} returned an unexpected value: ${JSON.stringify(remoteLine)}`)
    return { commit: sha, from: `remote ${remoteName} ${remoteRef}` }
  }
  const head = git(['rev-parse', 'HEAD'])
  if (head !== undefined && COMMIT.test(head)) {
    return { commit: head, from: `local HEAD (could not read ${remoteRef} from ${remoteName})` }
  }
  throw new Error(`could not resolve a commit: ${remoteName} ${remoteRef} unreadable and no local HEAD`)
}

function commitTime (ref) {
  const out = git(['show', '-s', '--format=%ct', ref])
  const seconds = Number.parseInt(out ?? '', 10)
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined
}

/** Publish time of name@version in the configured registry, when it is published. */
async function registryPublishTime (name, version, registry) {
  try {
    const base = (registry ?? 'https://registry.npmjs.org').replace(/\/$/u, '')
    const response = await fetch(`${base}/${name.replace('/', '%2f')}/${version}`)
    if (!response.ok) return undefined
    const meta = await response.json()
    const ms = Date.parse(meta.time ?? '')
    return Number.isInteger(ms) && ms > 0 ? Math.floor(ms / 1000) : undefined
  } catch {
    return undefined
  }
}

async function main () {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const { name, version } = manifest
  const enginesDsh = manifest.engines?.dsh
  if (typeof name !== 'string' || typeof version !== 'string') throw new Error('package.json needs name and version')
  if (typeof enginesDsh !== 'string') throw new Error('package.json needs engines.dsh')

  const kind = argOf('--source') ?? 'git'
  const registry = argOf('--registry')
  const repositoryUrl = repositoryWebUrl(manifest)
  const remoteName = argOf('--remote') ?? 'origin'
  const remoteRef = argOf('--remote-ref') ?? 'refs/heads/main'

  let source
  let commitInfo
  let commitForTime
  if (kind === 'git') {
    commitInfo = resolveCommit(remoteName, remoteRef)
    commitForTime = commitInfo.commit
    const dir = argOf('--path')
    source = {
      type: 'git',
      // Canonical https repository URL; marketInstallTarget appends no second .git.
      url: `${repositoryUrl}.git`,
      commit: commitInfo.commit,
      ...(dir === undefined ? {} : { path: dir })
    }
  } else if (kind === 'npm') {
    source = { type: 'npm', ...(registry === undefined ? {} : { registry }) }
  } else {
    throw new Error(`--source must be npm or git, got ${kind}`)
  }

  let publishTimestamp = Number.parseInt(argOf('--publish-timestamp') ?? '', 10)
  let derivedFrom = '--publish-timestamp'
  if (!Number.isInteger(publishTimestamp)) {
    if (kind === 'npm') {
      publishTimestamp = await registryPublishTime(name, version, registry)
      derivedFrom = 'registry publish time'
    }
    if (!Number.isInteger(publishTimestamp) && commitForTime !== undefined) {
      publishTimestamp = commitTime(commitForTime)
      derivedFrom = `git commit ${commitForTime.slice(0, 12)} time`
    }
    if (!Number.isInteger(publishTimestamp)) {
      publishTimestamp = commitTime('HEAD')
      derivedFrom = 'git HEAD commit time'
    }
    if (!Number.isInteger(publishTimestamp)) {
      publishTimestamp = Math.floor(Date.now() / 1000)
      derivedFrom = 'current time (WARNING: not reproducible; pass --publish-timestamp)'
    }
  }

  const index = {
    format: 1,
    title: AUTHORED.indexTitle,
    description: AUTHORED.indexDescription,
    metadata: {
      categories: AUTHORED.categories,
      labels: AUTHORED.labels
    },
    plugins: [
      {
        name,
        title: AUTHORED.pluginTitle,
        description: AUTHORED.pluginDescription,
        author: AUTHORED.author,
        homepage: repositoryUrl,
        repository: { url: repositoryUrl },
        metadata: {
          category: AUTHORED.category,
          keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
          labels: AUTHORED.pluginLabels
        },
        versions: [
          {
            version,
            publishTimestamp,
            source,
            engines: { dsh: enginesDsh }
          }
        ]
      }
    ]
  }

  fs.writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  console.log(`wrote ${path.relative(repoRoot, outFile)}`)
  console.log(`  plugin: ${name}@${version}  engines.dsh: ${enginesDsh}`)
  console.log(`  source: ${JSON.stringify(source)}`)
  if (commitInfo !== undefined) console.log(`  commit from: ${commitInfo.from}`)
  console.log(`  publishTimestamp: ${publishTimestamp} (from ${derivedFrom})`)

  if (commitInfo !== undefined) {
    const head = git(['rev-parse', 'HEAD'])
    if (head !== undefined && head !== commitInfo.commit) {
      console.log(`  note: local HEAD ${head} differs from the pinned commit (the index pins the pushed commit on purpose)`)
    }
  }
  console.log('next: node market/verify-index.cjs')
}

main().catch((error) => {
  console.error(`build-index: ${error.message}`)
  process.exitCode = 1
})
