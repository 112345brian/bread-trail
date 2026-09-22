import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error('Error: npm_package_version is not set. Run this via "npm version <patch|minor|major>" — never directly with node.');
	process.exit(1);
}

// Build the user-facing changelog while npm has already determined the target
// version. `npm version` still owns the resulting atomic commit and tag.
try {
	execFileSync('uvx', ['towncrier', 'build', '--version', targetVersion, '--yes'], { stdio: 'inherit' });
} catch {
	console.error('Error: Towncrier requires uv/uvx. Install it from https://docs.astral.sh/uv/ before releasing.');
	process.exit(1);
}

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
}
