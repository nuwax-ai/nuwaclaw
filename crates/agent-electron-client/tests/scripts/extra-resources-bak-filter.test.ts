import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, '..', '..');
const pkgPath = path.join(projectRoot, 'package.json');

interface ExtraResourceEntry {
  from?: string;
  to?: string;
  filter?: string[];
}

function collectResourceEntries(pkg: any): ExtraResourceEntry[] {
  const groups: unknown[] = [
    pkg.build?.extraResources,
    pkg.build?.mac?.extraResources,
    pkg.build?.win?.extraResources,
    pkg.build?.linux?.extraResources,
  ];

  return groups
    .filter((group): group is ExtraResourceEntry[] => Array.isArray(group))
    .flat()
    .filter(
      (entry): entry is ExtraResourceEntry =>
        typeof entry === 'object' && entry !== null && typeof entry.from === 'string' && entry.from.startsWith('resources/'),
    );
}

describe('build.extraResources bak-file exclusion', () => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const entries = collectResourceEntries(pkg);

  it('finds resources/* extraResources entries to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('excludes manual .bak backups from every resources/* extraResources entry', () => {
    const missing = entries.filter((entry) => !entry.filter?.includes('!**/*.bak*'));

    expect(missing.map((entry) => entry.from)).toEqual([]);
  });
});
