import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildForgePrompt, stripFences } from '../../src/daemon/forge/prompt.js';

describe('buildForgePrompt', () => {
  it('includes description', () => {
    const prompt = buildForgePrompt({ description: 'a bot that turns right', minimal: false });
    assert.ok(prompt.includes('a bot that turns right'));
  });

  it('includes AGENTS.md content', () => {
    const prompt = buildForgePrompt({ description: 'test', minimal: false });
    // AGENTS.md should contain the daemon reference.
    assert.ok(prompt.includes('DAEMON REFERENCE') || prompt.includes('AGENTS.md'));
  });

  it('includes minimal instructions when minimal=true', () => {
    const prompt = buildForgePrompt({ description: 'test', minimal: true });
    assert.ok(prompt.includes('SMALLEST'));
    assert.ok(prompt.includes('Minimalist'));
  });

  it('does not include minimal instructions when minimal=false', () => {
    const prompt = buildForgePrompt({ description: 'test', minimal: false });
    assert.ok(!prompt.includes('SMALLEST'));
  });

  it('includes existing source for refine', () => {
    const prompt = buildForgePrompt({
      description: 'make it faster',
      existingSource: 'console.log("hello")',
      minimal: false,
    });
    assert.ok(prompt.includes('console.log("hello")'));
    assert.ok(prompt.includes('change this daemon'));
  });
});

describe('stripFences', () => {
  it('strips ```javascript ... ``` fences', () => {
    const raw = '```javascript\nconsole.log("hi");\n```';
    assert.equal(stripFences(raw), 'console.log("hi");');
  });

  it('strips ```js ... ``` fences', () => {
    const raw = '```js\ncode here\n```';
    assert.equal(stripFences(raw), 'code here');
  });

  it('strips ``` ... ``` fences (no language)', () => {
    const raw = '```\ncode\n```';
    assert.equal(stripFences(raw), 'code');
  });

  it('returns raw if no fences', () => {
    const raw = 'just code';
    assert.equal(stripFences(raw), 'just code');
  });

  it('handles leading/trailing whitespace', () => {
    const raw = '  \n```js\ncode\n```\n  ';
    assert.equal(stripFences(raw), 'code');
  });

  it('handles multiple lines inside fences', () => {
    const raw = '```js\nline1\nline2\nline3\n```';
    assert.equal(stripFences(raw), 'line1\nline2\nline3');
  });
});
