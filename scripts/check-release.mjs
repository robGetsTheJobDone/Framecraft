import {readFile} from 'node:fs/promises';
const {version} = JSON.parse(await readFile(new URL('../packages/studio/package.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a stable semver version for the latest npm tag.');
if (process.env.RELEASE_TAG !== `v${version}`) throw new Error(`Release tag must be v${version}`);
console.log(`Release v${version} validated`);
