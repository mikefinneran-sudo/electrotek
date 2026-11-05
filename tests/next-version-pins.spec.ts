import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const EXPECTED = '16.4.5';

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const appPin: string = readJson(join(root, 'app/package.json')).dependencies.next;

const pkgDirs = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, 'packages', d.name, 'package.json')))
  .map((d) => d.name);

describe('next version pins', () => {
  it('app pins next to the expected release', () => {
    expect(appPin).toBe(EXPECTED);
  });

  it('finds workspace packages', () => {
    expect(pkgDirs.length).toBeGreaterThan(0);
  });

  it.each(pkgDirs)('packages/%s exact next pins match the app pin', (name) => {
    const pkg = readJson(join(root, 'packages', name, 'package.json'));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const v = pkg[field]?.next;
      if (v !== undefined) expect(v, `${name} ${field}.next`).toBe(appPin);
    }
  });
});
