#!/usr/bin/env node
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TARGETS = {
  agents: '.agents/skills',
  agent: '.agent/skills',
  github: '.github/skills',
};

function printHelp() {
  console.log(`Usage: node scripts/sync-skills.mjs [options]

Sync skill directories:
  - .agents/skills
  - .agent/skills
  - .github/skills

Options:
  --base <auto|agents|agent|github>  Base source directory (default: auto)
  --strategy <latest|base>           Sync strategy (default: latest)
  --dry-run                           Print actions without changing files
  --no-delete                         Do not delete target contents before copy
  --no-backup                         Do not create backup before overwrite
  --backup-dir <path>                 Backup directory (default: .skills-backups)
  --verbose                           Print per-directory metadata
  -h, --help                          Show this help

Examples:
  node scripts/sync-skills.mjs
  node scripts/sync-skills.mjs --base github
  node scripts/sync-skills.mjs --strategy base --base agents
  node scripts/sync-skills.mjs --base agents --dry-run
`);
}

function parseArgs(argv) {
  const opts = {
    base: 'auto',
    strategy: 'latest',
    dryRun: false,
    deleteFirst: true,
    backup: true,
    backupDir: '.skills-backups',
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--base requires a value');
      }
      opts.base = value;
      i += 1;
      continue;
    }
    if (arg === '--strategy') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--strategy requires a value');
      }
      opts.strategy = value;
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--no-backup') {
      opts.backup = false;
      continue;
    }
    if (arg === '--backup-dir') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--backup-dir requires a value');
      }
      opts.backupDir = value;
      i += 1;
      continue;
    }
    if (arg === '--no-delete') {
      opts.deleteFirst = false;
      continue;
    }
    if (arg === '--verbose') {
      opts.verbose = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return opts;
}

async function existsAsDirectory(dirPath) {
  try {
    const st = await stat(dirPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function hasEntries(dirPath) {
  try {
    const entries = await readdir(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function isCopyableEntry(entry) {
  return entry.isFile() || entry.isSymbolicLink();
}

async function getEntryDigest(absPath) {
  const st = await lstat(absPath);
  if (st.isSymbolicLink()) {
    const linkTarget = await readlink(absPath);
    return `symlink:${linkTarget}`;
  }
  if (!st.isFile()) {
    return null;
  }
  const bytes = await readFile(absPath);
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  return `file:${st.size}:${fileHash}`;
}

async function getNewestMtimeMs(rootDir) {
  const rootStat = await lstat(rootDir);
  let newest = rootStat.mtimeMs;
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const st = await lstat(fullPath);
      if (st.mtimeMs > newest) newest = st.mtimeMs;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return newest;
}

async function copyDirectoryContents(srcDir, destDir) {
  const stack = [{ srcDir, destDir }];

  while (stack.length > 0) {
    const current = stack.pop();
    await mkdir(current.destDir, { recursive: true });
    const entries = await readdir(current.srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const src = path.join(current.srcDir, entry.name);
      const dest = path.join(current.destDir, entry.name);

      if (entry.isDirectory()) {
        stack.push({ srcDir: src, destDir: dest });
        continue;
      }
      if (!isCopyableEntry(entry)) {
        continue;
      }

      let shouldCopy = true;
      try {
        const [srcDigest, destDigest] = await Promise.all([getEntryDigest(src), getEntryDigest(dest)]);
        shouldCopy = srcDigest !== destDigest;
      } catch {
        // Dest does not exist or cannot be compared. Copy as fallback.
        shouldCopy = true;
      }

      if (!shouldCopy) {
        continue;
      }

      await mkdir(path.dirname(dest), { recursive: true });
      await cp(src, dest, { recursive: false, force: true, errorOnExist: false });
    }
  }
}

async function materializeSnapshot(entries) {
  const snapshotDir = await mkdtemp(path.join(os.tmpdir(), 'skills-sync-'));
  for (const entry of entries) {
    const dest = path.join(snapshotDir, entry.relPath);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(entry.absPath, dest, { force: true, errorOnExist: false });
  }
  return snapshotDir;
}

async function listFilesWithMeta(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!isCopyableEntry(entry)) continue;
      const st = await lstat(fullPath);
      files.push({
        relPath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
        absPath: fullPath,
        mtimeMs: st.mtimeMs,
      });
    }
  }
  return files;
}

async function getDirectoryContentHash(rootDir) {
  const hasher = createHash('sha256');
  const stack = [rootDir];
  const entryPaths = [];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (isCopyableEntry(entry)) {
        entryPaths.push(fullPath);
      }
    }
  }

  entryPaths.sort((a, b) => a.localeCompare(b));

  for (const entryPath of entryPaths) {
    const relPath = path.relative(rootDir, entryPath).replace(/\\/g, '/');
    const digest = await getEntryDigest(entryPath);
    if (digest == null) continue;
    hasher.update(relPath);
    hasher.update(':');
    hasher.update(digest);
    hasher.update('\n');
  }

  return hasher.digest('hex');
}

async function getEntriesContentHash(fileEntries) {
  const hasher = createHash('sha256');
  const sorted = [...fileEntries].sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const entry of sorted) {
    const digest = await getEntryDigest(entry.absPath);
    if (digest == null) continue;
    hasher.update(entry.relPath);
    hasher.update(':');
    hasher.update(digest);
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

function normalizeBase(baseArg) {
  const key = String(baseArg || '').toLowerCase();
  if (key in TARGETS) return key;
  if (key === 'auto') return 'auto';
  if (key === '.agents/skills') return 'agents';
  if (key === '.agent/skills') return 'agent';
  if (key === '.github/skills') return 'github';
  throw new Error(`Invalid --base value: ${baseArg}`);
}

function normalizeStrategy(strategyArg) {
  const key = String(strategyArg || '').toLowerCase();
  if (key === 'latest' || key === 'base') return key;
  throw new Error(`Invalid --strategy value: ${strategyArg}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const targetInfo = await Promise.all(
    Object.entries(TARGETS).map(async ([name, relPath]) => {
      const absPath = path.resolve(repoRoot, relPath);
      const exists = await existsAsDirectory(absPath);
      const nonEmpty = exists ? await hasEntries(absPath) : false;
      const newestMtimeMs = exists ? await getNewestMtimeMs(absPath) : 0;
      return { name, relPath, absPath, exists, nonEmpty, newestMtimeMs };
    })
  );

  const existing = targetInfo.filter((t) => t.exists);
  if (existing.length === 0) {
    throw new Error('None of the skill directories exist.');
  }

  const strategy = normalizeStrategy(opts.strategy);
  const baseChoice = normalizeBase(opts.base);
  let base = null;

  if (baseChoice === 'auto') {
    const candidates = existing.filter((t) => t.nonEmpty);
    const pool = candidates.length > 0 ? candidates : existing;
    base = [...pool].sort((a, b) => b.newestMtimeMs - a.newestMtimeMs)[0];
  } else {
    base = targetInfo.find((t) => t.name === baseChoice) || null;
    if (!base || !base.exists) {
      throw new Error(`Selected base directory does not exist: ${TARGETS[baseChoice]}`);
    }
  }

  if (opts.verbose) {
    console.log('Detected skill directories:');
    for (const t of targetInfo) {
      console.log(
        `  - ${t.relPath} :: exists=${t.exists}, nonEmpty=${t.nonEmpty}, newest=${t.exists ? new Date(t.newestMtimeMs).toISOString() : 'n/a'}`
      );
    }
  }

  console.log(`Base: ${base.relPath}`);
  console.log(`Strategy: ${strategy}`);
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'apply'}${opts.deleteFirst ? ' (mirror)' : ' (overlay)'}`);
  if (!opts.dryRun && opts.backup) {
    console.log(`Backup: enabled (${opts.backupDir})`);
  }

  const backupStamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (strategy === 'base') {
    const baseHash = await getDirectoryContentHash(base.absPath);
    for (const t of targetInfo) {
      if (t.name === base.name) continue;
      const targetHash = t.exists ? await getDirectoryContentHash(t.absPath) : null;
      const hasDiff = targetHash !== baseHash;

      if (opts.dryRun) {
        console.log(`- Would sync ${base.relPath} -> ${t.relPath}`);
        if (opts.backup && hasDiff && t.exists) {
          const backupPath = path.join(opts.backupDir, backupStamp, t.name);
          console.log(`  (Would backup ${t.relPath} -> ${backupPath})`);
        }
        continue;
      }

      await mkdir(t.absPath, { recursive: true });
      if (opts.backup && hasDiff && t.exists) {
        const backupPath = path.resolve(repoRoot, opts.backupDir, backupStamp, t.name);
        await mkdir(path.dirname(backupPath), { recursive: true });
        await cp(t.absPath, backupPath, { recursive: true, force: true, errorOnExist: false });
        console.log(`- Backed up ${t.relPath} -> ${path.relative(repoRoot, backupPath).replace(/\\/g, '/')}`);
      }
      if (opts.deleteFirst) {
        await rm(t.absPath, { recursive: true, force: true });
        await mkdir(t.absPath, { recursive: true });
      }
      await copyDirectoryContents(base.absPath, t.absPath);
      console.log(`- Synced ${base.relPath} -> ${t.relPath}`);
    }
  } else {
    const orderedByPriority = [
      base.name,
      ...targetInfo.filter((t) => t.name !== base.name).map((t) => t.name),
    ];
    const priorityIndex = new Map(orderedByPriority.map((name, idx) => [name, idx]));

    const fileMap = new Map();
    for (const src of existing) {
      const files = await listFilesWithMeta(src.absPath);
      for (const file of files) {
        const prev = fileMap.get(file.relPath);
        if (!prev) {
          fileMap.set(file.relPath, { ...file, source: src.name });
          continue;
        }
        if (file.mtimeMs > prev.mtimeMs) {
          fileMap.set(file.relPath, { ...file, source: src.name });
          continue;
        }
        if (file.mtimeMs === prev.mtimeMs) {
          const prevPriority = priorityIndex.get(prev.source) ?? Number.MAX_SAFE_INTEGER;
          const nextPriority = priorityIndex.get(src.name) ?? Number.MAX_SAFE_INTEGER;
          if (nextPriority < prevPriority) {
            fileMap.set(file.relPath, { ...file, source: src.name });
          }
        }
      }
    }

    const mergedEntries = [...fileMap.entries()]
      .map(([relPath, value]) => ({ relPath, absPath: value.absPath, source: value.source }))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));
    const mergedHash = await getEntriesContentHash(mergedEntries);

    if (opts.verbose) {
      const sourceCount = new Map();
      for (const entry of mergedEntries) {
        sourceCount.set(entry.source, (sourceCount.get(entry.source) || 0) + 1);
      }
      console.log(`Merged files: ${mergedEntries.length}`);
      for (const [source, count] of sourceCount.entries()) {
        const rel = TARGETS[source] || source;
        console.log(`  - ${rel}: ${count} file(s) selected`);
      }
    }

    let snapshotDir = null;
    try {
      if (!opts.dryRun) {
        snapshotDir = await materializeSnapshot(mergedEntries);
      }

      for (const t of targetInfo) {
        const targetHash = t.exists ? await getDirectoryContentHash(t.absPath) : null;
        const hasDiff = targetHash !== mergedHash;

        if (opts.dryRun) {
          console.log(`- Would sync merged snapshot -> ${t.relPath}`);
          if (opts.backup && hasDiff && t.exists) {
            const backupPath = path.join(opts.backupDir, backupStamp, t.name);
            console.log(`  (Would backup ${t.relPath} -> ${backupPath})`);
          }
          continue;
        }

        if (!hasDiff) {
          console.log(`- Skipped ${t.relPath} (already in sync)`);
          continue;
        }

        await mkdir(t.absPath, { recursive: true });
        if (opts.backup && t.exists) {
          const backupPath = path.resolve(repoRoot, opts.backupDir, backupStamp, t.name);
          await mkdir(path.dirname(backupPath), { recursive: true });
          await cp(t.absPath, backupPath, { recursive: true, force: true, errorOnExist: false });
          console.log(`- Backed up ${t.relPath} -> ${path.relative(repoRoot, backupPath).replace(/\\/g, '/')}`);
        }
        if (opts.deleteFirst) {
          await rm(t.absPath, { recursive: true, force: true });
          await mkdir(t.absPath, { recursive: true });
        }
        await copyDirectoryContents(snapshotDir, t.absPath);
        console.log(`- Synced merged snapshot -> ${t.relPath}`);
      }
    } finally {
      if (snapshotDir) {
        await rm(snapshotDir, { recursive: true, force: true });
      }
    }
  }

  if (!opts.dryRun) {
    console.log('Skill sync completed.');
  }
}

main().catch((err) => {
  console.error(`Skill sync failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
