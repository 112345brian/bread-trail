/* eslint-disable import/no-nodejs-modules */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSettings, DEFAULT_SETTINGS } from './settings.js';

void describe('normalizeSettings', () => {
  void it('returns full defaults when called with empty object', () => {
    const s = normalizeSettings({});
    assert.equal(s.navigatorMode, 'context');
    assert.equal(s.navigatorBrowseStart, 'active');
    assert.equal(s.homeNote, '');
    assert.equal(s.navigatorRecentLimit, 50);
    assert.deepEqual(s.navigatorFavorites, []);
    assert.deepEqual(s.navigatorExcludeFolders, []);
  });

  void it('preserves valid persisted navigatorMode', () => {
    assert.equal(normalizeSettings({ navigatorMode: 'browser' }).navigatorMode, 'browser');
    assert.equal(normalizeSettings({ navigatorMode: 'recent' }).navigatorMode, 'recent');
    assert.equal(normalizeSettings({ navigatorMode: 'favorites' }).navigatorMode, 'favorites');
  });

  void it('resets unknown navigatorMode to context', () => {
    // Trap: if an old version wrote a mode that no longer exists, cold start
    // would put the navigator in an invalid state.
    assert.equal(normalizeSettings({ navigatorMode: 'pinboard' as never }).navigatorMode, 'context');
    assert.equal(normalizeSettings({ navigatorMode: '' as never }).navigatorMode, 'context');
  });

  void it('migrates legacy homepageDirectory to homepageTarget', () => {
    const s = normalizeSettings({ homepageDirectory: 'ARCHIVE' } as never);
    assert.equal(s.homepageTarget, 'ARCHIVE');
  });

  void it('migrates legacy homepageRootFolder to homepageTarget', () => {
    const s = normalizeSettings({ homepageRootFolder: 'Journal' } as never);
    assert.equal(s.homepageTarget, 'Journal');
  });

  void it('homepageTarget takes priority over legacy fields', () => {
    const s = normalizeSettings({ homepageTarget: 'new', homepageDirectory: 'old' } as never);
    assert.equal(s.homepageTarget, 'new');
  });

  void it('trims whitespace from string fields', () => {
    const s = normalizeSettings({ homeNote: '  index.md  ', navigatorSortField: ' Date ', navigatorFavoritesParentNote: ' meta/fav.md ' });
    assert.equal(s.homeNote, 'index.md');
    assert.equal(s.navigatorSortField, 'Date');
    assert.equal(s.navigatorFavoritesParentNote, 'meta/fav.md');
  });

  void it('filters non-string entries from array fields', () => {
    const s = normalizeSettings({ navigatorFavorites: ['a.md', 42, null, 'b.md'] as never });
    assert.deepEqual(s.navigatorFavorites, ['a.md', 'b.md']);
  });

  void it('migrates legacy explorerStartMode to explorerDefaultStart', () => {
    const s = normalizeSettings({ explorerStartMode: 'roots' } as never);
    assert.equal(s.explorerDefaultStart, 'roots');
  });

  void it('explorerDefaultStart takes priority over legacy explorerStartMode', () => {
    const s = normalizeSettings({ explorerDefaultStart: 'active-parent', explorerStartMode: 'roots' } as never);
    assert.equal(s.explorerDefaultStart, 'active-parent');
  });

  void it('normalizeSettings is idempotent — running twice gives same result', () => {
    const once = normalizeSettings(DEFAULT_SETTINGS);
    const twice = normalizeSettings(once);
    assert.deepEqual(once, twice);
  });

  void it('resets negative depth values to default', () => {
    const s = normalizeSettings({ parentDepth: -1, childDepth: -5 });
    assert.ok(s.parentDepth >= 0);
    assert.ok(s.childDepth >= 0);
  });

  void it('pinboard sections: missing sections get defaults, known types preserved', () => {
    const s = normalizeSettings({ navigatorPinboardSections: [
      { type: 'favorites', enabled: false, limit: 0, param: '' },
    ] });
    const types = s.navigatorPinboardSections.map((x) => x.type);
    assert.ok(types.includes('favorites'));
    assert.ok(types.includes('current'));
    assert.ok(types.includes('recents'));
    // User had favorites disabled — that should be preserved
    const fav = s.navigatorPinboardSections.find((x) => x.type === 'favorites');
    assert.equal(fav?.enabled, false);
  });
});
