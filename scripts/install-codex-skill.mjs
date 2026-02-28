#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function printHelp() {
  console.log(`Usage: node scripts/install-codex-skill.mjs [options] <skill-name> [<skill-name>...]

Install local skills into Codex home (~/.codex/skills by default).

Options:
  --all                     Install every skill under source directory
  --source <path>           Source skills directory (default: .agents/skills)
  --dest <path>             Destination skills directory (default: <CODEX_HOME>/skills)
  --config <path>           Codex config path (default: <CODEX_HOME>/config.toml)
  --no-config               Do not add [[skills.config]] entries
  --dry-run                 Print actions without making changes
  --list                    List skills found in source directory
  -h, --help                Show this help

Examples:
  node scripts/install-codex-skill.mjs bug-analysis
  node scripts/install-codex-skill.mjs --all
  node scripts/install-codex-skill.mjs --source .agent/skills bug-analysis
`);
}

function parseArgs(argv) {
  const opts = {
    all: false,
    source: '.agents/skills',
    dest: null,
    config: null,
    writeConfig: true,
    dryRun: false,
    list: false,
    help: false,
    names: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      opts.all = true;
      continue;
    }
    if (arg === '--source') {
      const value = argv[i + 1];
      if (!value) throw new Error('--source requires a value');
      opts.source = value;
      i += 1;
      continue;
    }
    if (arg === '--dest') {
      const value = argv[i + 1];
      if (!value) throw new Error('--dest requires a value');
      opts.dest = value;
      i += 1;
      continue;
    }
    if (arg === '--config') {
      const value = argv[i + 1];
      if (!value) throw new Error('--config requires a value');
      opts.config = value;
      i += 1;
      continue;
    }
    if (arg === '--no-config') {
      opts.writeConfig = false;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--list') {
      opts.list = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    opts.names.push(arg);
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

async function existsAsFile(filePath) {
  try {
    const st = await stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

async function listSkillDirectories(sourceDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function toTomlPath(p) {
  return p.replace(/\\/g, '/');
}

async function ensureConfigEntry(configPath, skillMarkdownPath, dryRun) {
  let current = '';
  try {
    current = await readFile(configPath, 'utf8');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }

  const normalized = toTomlPath(skillMarkdownPath);
  const pathLine = `path = "${normalized}"`;
  if (current.includes(pathLine)) {
    return { changed: false, reason: 'already-present', normalizedPath: normalized };
  }

  const needsTrailingNewline = current.length > 0 && !current.endsWith('\n');
  const prefix = needsTrailingNewline ? '\n' : '';
  const block = `${prefix}\n[[skills.config]]\n${pathLine}\nenabled = true\n`;

  if (!dryRun) {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${current}${block}`, 'utf8');
  }

  return { changed: true, reason: 'appended', normalizedPath: normalized };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const codexHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
  const sourceDir = path.resolve(cwd, opts.source);
  const destDir = opts.dest ? path.resolve(cwd, opts.dest) : path.join(codexHome, 'skills');
  const configPath = opts.config ? path.resolve(cwd, opts.config) : path.join(codexHome, 'config.toml');

  if (!(await existsAsDirectory(sourceDir))) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const availableSkills = await listSkillDirectories(sourceDir);

  if (opts.list) {
    if (availableSkills.length === 0) {
      console.log(`No skills found under ${sourceDir}`);
      return;
    }
    console.log(`Skills in ${sourceDir}:`);
    for (const name of availableSkills) {
      console.log(`- ${name}`);
    }
    return;
  }

  let selectedSkills = [];
  if (opts.all) {
    selectedSkills = availableSkills;
  } else {
    selectedSkills = opts.names;
  }

  if (selectedSkills.length === 0) {
    printHelp();
    throw new Error('No skill specified. Provide names or use --all.');
  }

  if (!opts.dryRun) {
    await mkdir(destDir, { recursive: true });
  }

  const summary = [];
  for (const skillName of selectedSkills) {
    const srcSkillDir = path.join(sourceDir, skillName);
    const srcSkillFile = path.join(srcSkillDir, 'SKILL.md');

    if (!(await existsAsDirectory(srcSkillDir))) {
      throw new Error(`Skill not found in source: ${skillName} (${srcSkillDir})`);
    }
    if (!(await existsAsFile(srcSkillFile))) {
      throw new Error(`Missing SKILL.md: ${srcSkillFile}`);
    }

    const destSkillDir = path.join(destDir, skillName);
    const destSkillFile = path.join(destSkillDir, 'SKILL.md');

    if (opts.dryRun) {
      console.log(`[dry-run] copy ${srcSkillDir} -> ${destSkillDir}`);
    } else {
      await cp(srcSkillDir, destSkillDir, { recursive: true, force: true, errorOnExist: false });
      console.log(`Installed: ${skillName}`);
    }

    let configResult = { changed: false, reason: 'disabled', normalizedPath: toTomlPath(destSkillFile) };
    if (opts.writeConfig) {
      configResult = await ensureConfigEntry(configPath, destSkillFile, opts.dryRun);
      if (opts.dryRun) {
        const action = configResult.changed ? 'append' : 'skip';
        console.log(`[dry-run] ${action} config entry: ${configResult.normalizedPath}`);
      } else if (configResult.changed) {
        console.log(`Registered in config: ${configResult.normalizedPath}`);
      }
    }

    summary.push({ skillName, destSkillDir, configResult });
  }

  console.log('\nDone.');
  console.log(`Destination: ${destDir}`);
  console.log(`Config: ${configPath}${opts.writeConfig ? '' : ' (not modified)'}`);
  console.log('Restart Codex to pick up new skills.');

  if (summary.length > 0) {
    console.log('Installed skill(s):');
    for (const item of summary) {
      console.log(`- ${item.skillName}`);
    }
  }
}

main().catch((err) => {
  console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
