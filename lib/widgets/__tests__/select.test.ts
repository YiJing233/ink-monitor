import { describe, it, expect } from 'vitest';
import { selectPath, applySelect } from '../select';

const data = {
  data: { items: [{ summary: 'a', done: true }, { summary: 'b', done: false }] },
  list: [
    { main: { temp: 10 }, weather: [{ main: 'Rain' }] },
    { main: { temp: 12 }, weather: [{ main: 'Sun' }] },
  ],
};

const arrRoot = [
  { title: 'fix login', number: 17 },
  { title: 'add widget', number: 42 },
];

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

  it('returns length for arrays and strings', () => {
    expect(selectPath([1, 2, 3, 4], 'length')).toBe(4);
    expect(selectPath(data, 'data.items.length')).toBe(2);
    expect(selectPath(data, 'data.items.length0')).toBeUndefined();
    expect(selectPath('hello', 'length')).toBe(5);
    expect(selectPath({ items: [] }, 'items.length')).toBe(0);
    expect(selectPath({ nope: 1 }, 'nope.length')).toBeUndefined();
  });

  it('treats [@] as an alias for the element wildcard', () => {
    expect(selectPath(arrRoot, '[@]')).toEqual(arrRoot);
    expect(selectPath(arrRoot, '[@].title')).toEqual(['fix login', 'add widget']);
    expect(selectPath(data, 'list[@].main.temp')).toEqual([10, 12]);
    expect(selectPath(data, 'data.items[@].summary')).toEqual(['a', 'b']);
  });

  it('walks numeric tokens (and chained indices) as array positions', () => {
    expect(selectPath([10, 20, 30], '0')).toBe(10);
    expect(selectPath([10, 20, 30], '2')).toBe(30);
    expect(selectPath(arrRoot, '1.title')).toBe('add widget');
    expect(selectPath(arrRoot, '0.number')).toBe(17);
  });

  it('combines numeric index with [*] wildcard (multi-layer index + map)', () => {
    const list = [
      { items: [{ v: 1 }, { v: 2 }] },
      { items: [{ v: 3 }] },
    ];
    expect(selectPath(list, '[0].items[*].v')).toEqual([1, 2]);
    expect(selectPath(list, '[1].items[0].v')).toBe(3);
    expect(selectPath(list, '[*].items[0].v')).toEqual([1, 3]);
  });

  // F11: a JSON body carrying a __proto__ / constructor / prototype key
  // must not let the walker reach Object.prototype (or pollute downstream
  // objects via prototype writes).
  it('refuses to walk __proto__ / constructor / prototype', () => {
    // Construct a payload where `__proto__` is an own data property — the
    // exact shape an attacker would ship via a hostile API response.
    const payload = JSON.parse('{"__proto__":{"secret":"leaked"},"safe":1}');
    expect(selectPath(payload, '__proto__.secret')).toBeUndefined();
    expect(selectPath(payload, 'constructor')).toBeUndefined();
    expect(selectPath(payload, 'constructor.prototype')).toBeUndefined();
    expect(selectPath(payload, 'prototype')).toBeUndefined();
    // The non-proto lookup still works.
    expect(selectPath(payload, 'safe')).toBe(1);
    // And we must not have polluted Object.prototype with the payload.
    expect((Object.prototype as unknown as { secret?: string }).secret).toBeUndefined();
  });
  it('refuses prototype-chain lookup even on arrays', () => {
    const arr = JSON.parse('[1,2,3]');
    expect(selectPath(arr, 'constructor')).toBeUndefined();
    expect(selectPath(arr, '__proto__')).toBeUndefined();
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
  it('supports length and [@] / [*] together in a select map (PR list example)', () => {
    const out = applySelect(arrRoot, {
      count: 'length',
      items: '[@]',
      titles: '[*].title',
      numbers: '[*].number',
    }) as Record<string, unknown>;
    expect(out.count).toBe(2);
    expect(out.items).toEqual(arrRoot);
    expect(out.titles).toEqual(['fix login', 'add widget']);
    expect(out.numbers).toEqual([17, 42]);
  });
});
