import { describe, expect, it } from 'vitest';

import { renderBanner, showBanner } from './banner.js';

const ESC = new RegExp(String.fromCharCode(27));

describe('renderBanner', () => {
  it('spells out the tool name', () => {
    const plain = renderBanner({ version: '1.0.0', color: false });
    expect(plain.split('\n').filter((line) => line.includes('█'))).toHaveLength(5);
    expect(plain).toContain('v1.0.0');
  });

  it('fits in an 80 column terminal', () => {
    const widest = Math.max(
      ...renderBanner({ version: '1.0.0', color: false })
        .split('\n')
        .map((line) => line.length),
    );
    expect(widest).toBeLessThanOrEqual(80);
  });

  it('emits no escape codes when colour is off', () => {
    expect(renderBanner({ version: '1.0.0', color: false })).not.toMatch(ESC);
  });

  it('emits escape codes when colour is on', () => {
    expect(renderBanner({ version: '1.0.0', color: true })).toMatch(ESC);
  });

  it('follows the stream it is written to, not stderr', () => {
    const notATty = { isTTY: false } as NodeJS.WriteStream;
    expect(renderBanner({ version: '1.0.0', stream: notATty })).not.toMatch(ESC);
  });

  it('accepts a custom tagline', () => {
    expect(renderBanner({ version: '1.0.0', color: false, tagline: 'hello' })).toContain('hello');
  });
});

describe('showBanner', () => {
  function capture() {
    const chunks: string[] = [];
    return { chunks, write: (text: string) => chunks.push(text) };
  }

  it('writes when nothing suppresses it', () => {
    const out = capture();
    expect(showBanner({ version: '1.0.0', color: false, write: out.write })).toBe(true);
    expect(out.chunks.join('')).toContain('█');
  });

  it('stays silent when suppressed', () => {
    const out = capture();
    expect(showBanner({ version: '1.0.0', suppressed: true, write: out.write })).toBe(false);
    expect(out.chunks).toHaveLength(0);
  });

  it('stays silent when a tty is required and stderr is redirected', () => {
    const out = capture();
    const wasTty = process.stderr.isTTY;
    try {
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
      expect(showBanner({ version: '1.0.0', requireTty: true, write: out.write })).toBe(false);
    } finally {
      Object.defineProperty(process.stderr, 'isTTY', { value: wasTty, configurable: true });
    }
    expect(out.chunks).toHaveLength(0);
  });
});
