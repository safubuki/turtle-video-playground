#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const sourceRepoOwner = process.env.SOURCE_REPO_OWNER ?? 'safubuki';
const sourceRepoName = process.env.SOURCE_REPO_NAME ?? 'turtle-video';
const targetRepoOwner =
  process.env.TARGET_REPO_OWNER ??
  process.env.GITHUB_REPOSITORY_OWNER ??
  process.env.GITHUB_REPOSITORY?.split('/')[0] ??
  sourceRepoOwner;
const targetRepoName =
  process.env.TARGET_REPO_NAME ??
  process.env.GITHUB_REPOSITORY?.split('/')[1] ??
  'turtle-video-playground';
const targetAppTitle = process.env.TARGET_APP_TITLE ?? 'タートルビデオ Playground';
const targetLocalRepoPath = process.env.TARGET_LOCAL_REPO_PATH ?? `C:\\git_home\\${targetRepoName}`;

const sourceRepoSlug = `${sourceRepoOwner}/${sourceRepoName}`;
const targetRepoSlug = `${targetRepoOwner}/${targetRepoName}`;
const sourcePagesUrl = `https://${sourceRepoOwner}.github.io/${sourceRepoName}/`;
const targetPagesUrl = `https://${targetRepoOwner}.github.io/${targetRepoName}/`;
const sourceBasePath = `/${sourceRepoName}/`;
const targetBasePath = `/${targetRepoName}/`;
const sourceLocalRepoPath = `C:\\git_home\\${sourceRepoName}`;

function replaceAll(text, source, target) {
  return text.split(source).join(target);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceToken(text, source, target) {
  return text.replace(new RegExp(`${escapeRegExp(source)}(?![-\\w])`, 'g'), target);
}

function replaceExactLine(text, source, target) {
  return text.replace(new RegExp(`^${escapeRegExp(source)}$`, 'gm'), target);
}

async function updateTextFile(filePath, transform) {
  let original;
  try {
    original = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`[skip] ${filePath} (not found)`);
      return;
    }
    throw error;
  }

  const updated = transform(original);
  if (updated === original) {
    console.log(`[keep] ${filePath}`);
    return;
  }

  await writeFile(filePath, updated, 'utf8');
  console.log(`[update] ${filePath}`);
}

async function updateJsonFile(filePath, transform) {
  await updateTextFile(filePath, (original) => {
    const data = JSON.parse(original);
    transform(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  });
}

function updateRepoSpecificText(text) {
  let updated = text;
  updated = replaceToken(updated, sourceRepoSlug, targetRepoSlug);
  updated = replaceAll(updated, sourcePagesUrl, targetPagesUrl);
  updated = replaceToken(updated, sourceLocalRepoPath, targetLocalRepoPath);
  updated = replaceExactLine(updated, `${sourceRepoName}/`, `${targetRepoName}/`);
  return updated;
}

async function main() {
  console.log(`Applying sync overrides for ${targetRepoSlug}`);

  await updateTextFile('vite.config.ts', (text) =>
    text
      .replace(/scope:\s*['"][^'"]*['"]/, `scope: '${targetBasePath}'`)
      .replace(/start_url:\s*['"][^'"]*['"]/, `start_url: '${targetBasePath}'`)
      .replace(/base:\s*['"][^'"]*['"]/, `base: '${targetBasePath}'`),
  );

  await updateTextFile('index.html', (text) => replaceAll(text, sourceBasePath, targetBasePath));

  await updateJsonFile('package.json', (data) => {
    data.name = targetRepoName;
    data.repository = {
      ...(data.repository ?? {}),
      type: 'git',
      url: `git+https://github.com/${targetRepoSlug}.git`,
    };
    data.bugs = {
      ...(data.bugs ?? {}),
      url: `https://github.com/${targetRepoSlug}/issues`,
    };
    data.homepage = `https://github.com/${targetRepoSlug}#readme`;
  });

  await updateJsonFile('package-lock.json', (data) => {
    data.name = targetRepoName;
    if (data.packages && data.packages['']) {
      data.packages[''].name = targetRepoName;
    }
  });

  await updateTextFile('README.md', (text) => {
    const withTitle = text.replace(/^# .*$/m, `# ${targetAppTitle}`);
    return updateRepoSpecificText(withTitle);
  });

  await updateTextFile('Docs/developer_guide.md', updateRepoSpecificText);
  await updateTextFile('Docs/github_issue_workflow.md', updateRepoSpecificText);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
