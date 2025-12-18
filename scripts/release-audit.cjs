#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function readRootManifest() {
  const manifestPath = path.join(process.cwd(), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json not found in repository root');
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function findZipCandidate() {
  const explicit = process.argv[2];
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`Provided zip path not found: ${explicit}`);
    }
    return explicit;
  }

  const entries = fs
    .readdirSync(process.cwd())
    .filter((file) => file.startsWith('snipsidian-') && file.endsWith('.zip'));

  if (entries.length === 0) {
    return null;
  }

  const sorted = entries.sort((a, b) => {
    const versionA = a.match(/snipsidian-([^.]+\..+?)\.zip/);
    const versionB = b.match(/snipsidian-([^.]+\..+?)\.zip/);
    return (versionB?.[1] || '').localeCompare(versionA?.[1] || '', undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return sorted[0];
}

function readZipFile(zipPath, filePath) {
  try {
    return execSync(`unzip -p ${zipPath} ${filePath}`, { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`Failed to read ${filePath} from ${zipPath}: ${error.message}`);
  }
}

function listZip(zipPath) {
  try {
    const output = execSync(`unzip -l ${zipPath}`, { encoding: 'utf8' });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && /\d+\s+.+/.test(line))
      .map((line) => line.split(/\s+/))
      .filter((parts) => parts.length >= 4 && parts[3] !== 'files')
      .map((parts) => parts.slice(3).join(' '));
  } catch (error) {
    throw new Error(`Failed to list ${zipPath}: ${error.message}`);
  }
}

function extractTagFromFilename(zipPath) {
  const base = path.basename(zipPath);
  const match = base.match(/snipsidian-((?:v)?\d+\.\d+\.\d+)\.zip/);
  return match ? match[1] : null;
}

function validateStructure(files) {
  const allowed = new Set(['main.js', 'manifest.json', 'styles.css']);
  const problems = [];

  files.forEach((file) => {
    const normalized = file.replace(/^\.\//, '');
    if (normalized.endsWith('/')) {
      problems.push(`Unexpected directory in zip: ${normalized}`);
      return;
    }

    const parts = normalized.split('/');
    if (parts.length > 1) {
      problems.push(`Unexpected nested path: ${normalized}`);
      return;
    }

    if (!allowed.has(normalized)) {
      problems.push(`Unexpected file in zip: ${normalized}`);
    }
  });

  return {
    fileStructureOk: problems.length === 0,
    problems,
  };
}

function main() {
  const problems = [];
  const { version: manifestVersion } = readRootManifest();

  const zipPath = findZipCandidate();
  if (!zipPath) {
    problems.push('No snipsidian-*.zip found in repository root. Run npm run release:zip first.');
    output({ manifestVersion, releaseTag: null, manifestInsideZipVersion: null, fileStructureOk: false, problems });
    process.exit(1);
  }

  const releaseTag = extractTagFromFilename(zipPath);
  if (!releaseTag) {
    problems.push('Zip filename does not follow expected pattern snipsidian-X.Y.Z.zip');
  }

  const zipManifestRaw = readZipFile(zipPath, 'manifest.json');
  let manifestInsideZipVersion = null;
  try {
    manifestInsideZipVersion = JSON.parse(zipManifestRaw).version;
  } catch (error) {
    problems.push(`Unable to parse manifest.json inside zip: ${error.message}`);
  }

  const files = listZip(zipPath);
  const { fileStructureOk, problems: structureProblems } = validateStructure(files);
  problems.push(...structureProblems);

  if (releaseTag && releaseTag !== manifestVersion) {
    problems.push(`Release tag ${releaseTag} does not match repository manifest version ${manifestVersion}`);
  }

  if (manifestInsideZipVersion && manifestInsideZipVersion !== manifestVersion) {
    problems.push(
      `Manifest inside zip (${manifestInsideZipVersion}) does not match repository manifest version (${manifestVersion})`,
    );
  }

  output({ manifestVersion, releaseTag, manifestInsideZipVersion, fileStructureOk, problems });
}

function output(result) {
  console.log(JSON.stringify(result, null, 2));
  if (result.problems.length === 0 && result.fileStructureOk) {
    console.log('READY FOR OBSIDIAN REVIEW ✔️');
  } else {
    console.log('READY FOR OBSIDIAN REVIEW ❌');
  }
}

main();
