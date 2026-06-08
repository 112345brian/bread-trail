/* eslint-disable import/no-nodejs-modules */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPathInRootFolder, normalizeRootFolder, shouldIncludeVaultRoot } from './homepageRoots';

void describe('homepage root helpers', () => {
  void it('normalizes configured root folders', () => {
    assert.equal(normalizeRootFolder(' /ARCHIVE/ '), 'ARCHIVE');
    assert.equal(normalizeRootFolder(''), '');
  });

  void it('matches only files inside the configured root folder', () => {
    assert.equal(isPathInRootFolder('ARCHIVE/Index.md', 'ARCHIVE'), true);
    assert.equal(isPathInRootFolder('ARCHIVE/Nietzsche/Note.md', '/ARCHIVE/'), true);
    assert.equal(isPathInRootFolder('RESOURCES/Note.md', 'ARCHIVE'), false);
    assert.equal(isPathInRootFolder('ARCHIVE.md', 'ARCHIVE'), false);
  });

  void it('includes parentless notes inside a homepage target folder even without children', () => {
    assert.equal(shouldIncludeVaultRoot({
      path: 'ARCHIVE/Root without children.md',
      hasChildren: false,
      hasParent: false,
    }, 'ARCHIVE'), true);
  });

  void it('excludes parented notes inside a homepage target folder', () => {
    assert.equal(shouldIncludeVaultRoot({
      path: 'ARCHIVE/Child.md',
      hasChildren: true,
      hasParent: true,
    }, 'ARCHIVE'), false);
  });

  void it('keeps the normal vault root view limited to parentless notes with children', () => {
    assert.equal(shouldIncludeVaultRoot({
      path: 'Root with children.md',
      hasChildren: true,
      hasParent: false,
    }), true);
    assert.equal(shouldIncludeVaultRoot({
      path: 'Loose orphan.md',
      hasChildren: false,
      hasParent: false,
    }), false);
  });
});
