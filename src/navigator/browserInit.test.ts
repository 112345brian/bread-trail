/* eslint-disable import/no-nodejs-modules */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeBcBrowserInit } from './browserInit.js';

// Helpers to build lightweight resolver callbacks

function pathResolver(files: Record<string, 'file' | 'folder'>) {
  return (path: string) => {
    const kind = files[path];
    return kind ? { kind, path } : null;
  };
}

function basenameResolver(map: Record<string, string>) {
  return (basename: string) => map[basename] ?? null;
}

function parentResolver(map: Record<string, string | null>) {
  return (path: string) => map[path] ?? null;
}

const NO_FILES = pathResolver({});
const NO_BASENAMES = basenameResolver({});
const NO_PARENTS = parentResolver({});

void describe('computeBcBrowserInit — homeNote resolution', () => {
  void it('homeNote resolves to a file → stack contains that file, rootFolder null', () => {
    const result = computeBcBrowserInit({
      homeNote: 'notes/index.md',
      browseStart: 'active',
      resolveByPath: pathResolver({ 'notes/index.md': 'file' }),
      resolveByBasename: NO_BASENAMES,
      getParentPath: NO_PARENTS,
      activePath: null,
    });
    assert.deepEqual(result.browserStack, ['notes/index.md']);
    assert.equal(result.browserRootFolder, null);
  });

  void it('homeNote resolves to a folder → empty stack, rootFolder set (the 1.2.18 regression)', () => {
    // Before the fix: a folder homeNote caused browserViewMode to stay as 'files' (wrong).
    // computeBcBrowserInit must NOT include a browserViewMode field — the caller owns that.
    const result = computeBcBrowserInit({
      homeNote: 'Reference',
      browseStart: 'active',
      resolveByPath: pathResolver({ Reference: 'folder' }),
      resolveByBasename: NO_BASENAMES,
      getParentPath: NO_PARENTS,
      activePath: null,
    });
    assert.deepEqual(result.browserStack, []);
    assert.equal(result.browserRootFolder, 'Reference');
    // Pure function returns no browserViewMode — callers that need cold-start safety
    // simply never write browserViewMode back.
    assert.ok(!('browserViewMode' in result));
  });

  void it('folder homeNote with root path → rootFolder null (vault root, no scoping)', () => {
    const result = computeBcBrowserInit({
      homeNote: '/',
      browseStart: 'active',
      resolveByPath: pathResolver({ '/': 'folder' }),
      resolveByBasename: NO_BASENAMES,
      getParentPath: NO_PARENTS,
      activePath: null,
    });
    assert.deepEqual(result.browserStack, []);
    assert.equal(result.browserRootFolder, null);
  });

  void it('homeNote not found by path, unique basename match → stack contains matched file', () => {
    const result = computeBcBrowserInit({
      homeNote: 'index',
      browseStart: 'active',
      resolveByPath: NO_FILES,
      resolveByBasename: basenameResolver({ index: 'vault/index.md' }),
      getParentPath: NO_PARENTS,
      activePath: null,
    });
    assert.deepEqual(result.browserStack, ['vault/index.md']);
    assert.equal(result.browserRootFolder, null);
  });

  void it('homeNote not found and ambiguous basename → falls through, ignores basename', () => {
    // Multiple notes share the basename — no match returned by the resolver
    const result = computeBcBrowserInit({
      homeNote: 'notes',
      browseStart: 'roots',
      resolveByPath: NO_FILES,
      resolveByBasename: NO_BASENAMES, // caller returns null for ambiguous
      getParentPath: NO_PARENTS,
      activePath: null,
    });
    assert.deepEqual(result.browserStack, []);
    assert.equal(result.browserRootFolder, null);
  });
});

void describe('computeBcBrowserInit — browseStart fallback', () => {
  void it("browseStart 'roots' → empty stack", () => {
    const result = computeBcBrowserInit({
      homeNote: '',
      browseStart: 'roots',
      resolveByPath: NO_FILES,
      resolveByBasename: NO_BASENAMES,
      getParentPath: NO_PARENTS,
      activePath: 'notes/foo.md',
    });
    assert.deepEqual(result.browserStack, []);
    assert.equal(result.browserRootFolder, null);
  });

  void it("browseStart 'active', active file has a BC parent → stack = [parent]", () => {
    const result = computeBcBrowserInit({
      homeNote: '',
      browseStart: 'active',
      resolveByPath: NO_FILES,
      resolveByBasename: NO_BASENAMES,
      getParentPath: parentResolver({ 'notes/foo.md': 'notes/parent.md' }),
      activePath: 'notes/foo.md',
    });
    assert.deepEqual(result.browserStack, ['notes/parent.md']);
    assert.equal(result.browserRootFolder, null);
  });

  void it("browseStart 'active', active file has no BC parent → stack = [active file itself]", () => {
    // getBrowserContainerForActiveFile falls back to activeFile when no parent found
    const result = computeBcBrowserInit({
      homeNote: '',
      browseStart: 'active',
      resolveByPath: NO_FILES,
      resolveByBasename: NO_BASENAMES,
      getParentPath: NO_PARENTS,
      activePath: 'notes/foo.md',
    });
    assert.deepEqual(result.browserStack, ['notes/foo.md']);
    assert.equal(result.browserRootFolder, null);
  });

  void it("browseStart 'active' but no active file → empty stack", () => {
    // Caller passes null activePath when bc or activeFile unavailable
    const result = computeBcBrowserInit({
      homeNote: '',
      browseStart: 'active',
      resolveByPath: NO_FILES,
      resolveByBasename: NO_BASENAMES,
      getParentPath: NO_PARENTS,
      activePath: null,
    });
    assert.deepEqual(result.browserStack, []);
    assert.equal(result.browserRootFolder, null);
  });
});

void describe('computeBcBrowserInit — homeNote priority over browseStart', () => {
  void it('homeNote (file) takes priority over browseStart=roots', () => {
    const result = computeBcBrowserInit({
      homeNote: 'index.md',
      browseStart: 'roots',
      resolveByPath: pathResolver({ 'index.md': 'file' }),
      resolveByBasename: NO_BASENAMES,
      getParentPath: NO_PARENTS,
      activePath: 'other.md',
    });
    assert.deepEqual(result.browserStack, ['index.md']);
  });

  void it('homeNote (folder) takes priority over browseStart=active', () => {
    const result = computeBcBrowserInit({
      homeNote: 'Archive',
      browseStart: 'active',
      resolveByPath: pathResolver({ Archive: 'folder' }),
      resolveByBasename: NO_BASENAMES,
      getParentPath: parentResolver({ 'Archive/note.md': 'Archive/parent.md' }),
      activePath: 'Archive/note.md',
    });
    // Must scope to folder, not follow active-file parent
    assert.deepEqual(result.browserStack, []);
    assert.equal(result.browserRootFolder, 'Archive');
  });
});
