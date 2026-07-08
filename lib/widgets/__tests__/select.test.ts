import { describe, it, expect } from 'vitest';
import { selectPath, applySelect } from '../select';

const data = {
  data: { items: [{ summary: 'a', done: true }, { summary: 'b', done: false }] },
  list: [
    { main: { temp: 10 }, weather: [{ main: 'Rain' }] },
    { main: { temp: 12 }, weather: [{ main: 'Sun' }] },
  ],
};

describe('selectPath', () => {
  it('resolves dotted paths', () => {
    expect(selectPath(data, 'data.items')).toHaveLength(2);
    expect(selectPath(data, 'list[0].main.temp')).toBe(10);
    expect(selectPath(data, 'list[1].weather[0].main')).toBe('Sun');
  });
  it('maps with the [*] wildcard', () => {
    expect(selectPath(data, 'list[*].main.temp')).toEqual([10, 12]);
    expect(selectPath(data, 'data.items[*].summary')).toEqual(['a', 'b']);
  });
  it('returns undefined for missing paths', () => {
    expect(selectPath(data, 'nope.nada')).toBeUndefined();
    expect(selectPath(data, 'list[9].main')).toBeUndefined();
  });
  it('returns the root for an empty path', () => {
    expect(selectPath(data, '')).toBe(data);
  });
});

describe('applySelect', () => {
  it('builds a flat object from the select map', () => {
    const out = applySelect(data, { items: 'data.items', temps: 'list[*].main.temp' }) as Record<string, unknown>;
    expect(out.items).toHaveLength(2);
    expect(out.temps).toEqual([10, 12]);
  });
  it('passes through when no select map', () => {
    expect(applySelect(data, undefined)).toBe(data);
  });
});
