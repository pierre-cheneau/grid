import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { renderEpitaph } from '../../src/render/epitaph.js';
import { stripAnsi } from './extract-cells.js';

describe('renderEpitaph', () => {
  const data = {
    identity: 'corne@thinkpad',
    identityColor: [0, 255, 200] as const,
    durationMs: 94_000,
    derezzes: 4,
    deaths: 6,
    longestRunMs: 18_000,
  };

  it('contains the identity string', () => {
    const out = stripAnsi(renderEpitaph(data, 60));
    assert.match(out, /corne@thinkpad/);
  });

  it('formats duration as minutes and seconds', () => {
    const out = stripAnsi(renderEpitaph(data, 60));
    assert.match(out, /1m 34s/);
  });

  it('formats short duration as seconds only', () => {
    const out = stripAnsi(renderEpitaph({ ...data, durationMs: 45_000 }, 60));
    assert.match(out, /45s/);
  });

  it('contains derezzes and deaths counts', () => {
    const out = stripAnsi(renderEpitaph(data, 60));
    assert.match(out, /4 derezzes/);
    assert.match(out, /6 deaths/);
  });

  it('contains longest run', () => {
    const out = stripAnsi(renderEpitaph(data, 60));
    assert.match(out, /longest run 18s/);
  });

  it('contains the recap hint', () => {
    const out = stripAnsi(renderEpitaph(data, 60));
    assert.match(out, /npx grid recap/);
  });

  it('ends with a newline', () => {
    const out = renderEpitaph(data, 60);
    assert.ok(out.endsWith('\n'));
  });

  it('includes crown labels when provided', () => {
    const out = stripAnsi(
      renderEpitaph(
        {
          ...data,
          crowns: [
            {
              crown: 'last-standing',
              winnerId: 'a@host',
              value: 60000,
              label: 'Last Standing a@host (1m 0s)',
            },
            { crown: 'reaper', winnerId: 'b@host', value: 5, label: 'Reaper b@host (5 kills)' },
          ],
          dayTag: '2026-04-09',
        },
        80,
      ),
    );
    assert.match(out, /Last Standing a@host/);
    assert.match(out, /Reaper b@host/);
  });

  it('omits crown line when no crowns', () => {
    const out = stripAnsi(renderEpitaph(data, 60));
    assert.doesNotMatch(out, /Last Standing|Reaper|Mayfly/);
  });
});
