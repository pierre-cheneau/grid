// Tests for the sorted-iteration helpers.
//
// These are tiny but they pin the most important property in the project: that
// iteration order is locale-independent and lexicographic by code unit. A bug here
// would silently corrupt the canonical hash on machines with different locales.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { sortedEntries, sortedKeys, sortedValuesByKey } from '../../src/sim/iter.js';

describe('iter', () => {
  describe('sortedKeys', () => {
    it('returns an empty array for an empty map', () => {
      assert.deepEqual(sortedKeys(new Map()), []);
    });

    it('returns keys in lexicographic order regardless of insertion order', () => {
      const a = new Map([
        ['banana', 1],
        ['apple', 2],
        ['cherry', 3],
      ]);
      const b = new Map([
        ['cherry', 3],
        ['apple', 2],
        ['banana', 1],
      ]);
      assert.deepEqual(sortedKeys(a), ['apple', 'banana', 'cherry']);
      assert.deepEqual(sortedKeys(b), ['apple', 'banana', 'cherry']);
    });

    it('sorts by code unit, not by locale', () => {
      // In de-DE locale, 'ä' sorts after 'a' and before 'b'. By code unit, U+00E4 (228)
      // sorts AFTER 'z' (122). The simulation must use the code-unit order.
      const m = new Map([
        ['a', 1],
        ['z', 2],
        ['ä', 3],
      ]);
      assert.deepEqual(sortedKeys(m), ['a', 'z', 'ä']);
    });

    it('handles numeric-looking keys lexicographically (NOT numerically)', () => {
      // "10" < "2" lexicographically. The canonical hash relies on this.
      const m = new Map([
        ['1', 1],
        ['2', 2],
        ['10', 3],
      ]);
      assert.deepEqual(sortedKeys(m), ['1', '10', '2']);
    });
  });

  describe('sortedEntries', () => {
    it('returns entries in lex key order', () => {
      const m = new Map([
        ['b', 'second'],
        ['a', 'first'],
      ]);
      assert.deepEqual(sortedEntries(m), [
        ['a', 'first'],
        ['b', 'second'],
      ]);
    });

    it('does not mutate the source map', () => {
      const m = new Map([
        ['z', 1],
        ['a', 2],
      ]);
      const originalOrder = Array.from(m.keys());
      sortedEntries(m);
      assert.deepEqual(Array.from(m.keys()), originalOrder);
    });
  });

  describe('sortedValuesByKey', () => {
    it('returns values in the same order as sortedKeys', () => {
      const m = new Map([
        ['c', 30],
        ['a', 10],
        ['b', 20],
      ]);
      assert.deepEqual(sortedValuesByKey(m), [10, 20, 30]);
    });
  });
});
