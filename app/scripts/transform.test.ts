import { describe, it, expect } from 'vitest';
import { transform, statValue } from './transform';

const raw = {
  attribution: 'x', source: 'y', license: 'z', generated: 'g', areas: [],
  routes: [
    {
      slug: 'kasteelspoort', title: 'Kasteelspoort',
      url: 'https://sites.google.com/site/mm/Home/tm/aw/kasteelspoort',
      area: ['tm', 'aw'], coords: { lat: -33.9, lon: 18.3, zoom: 16 },
      grade: '1 ***', grade_source: 'label',
      stats: { Time: '2 hrs', 'Height gain': '530m' },
      sections: { Overview: 'A path.' }, description: 'A path.',
      related: ['/site/mm/Home/tm/aw/other'], attachments: [],
      photos: { deck_ids: ['d1'], inline_urls: ['a', 'b'] }, is_reference: false
    },
    {
      slug: 'other', title: 'Other',
      url: 'https://sites.google.com/site/mm/Home/tm/aw/other',
      area: ['tm', 'aw'], coords: null, grade: null, grade_source: null,
      stats: {}, sections: {}, description: 'Short note.',
      related: [], attachments: [], photos: { deck_ids: [], inline_urls: [] }, is_reference: false
    }
  ]
};

describe('statValue', () => {
  it('matches keys case-insensitively', () => {
    expect(statValue({ 'Height Gain': '410m' }, 'height gain')).toBe('410m');
  });
});

describe('transform', () => {
  it('emits one index entry per route with a stable id', () => {
    expect(transform(raw).index.map((e) => e.id)).toEqual(['tm--aw--kasteelspoort', 'tm--aw--other']);
  });
  it('carries time and height gain out of the stats table', () => {
    const e = transform(raw).index[0];
    expect(e.time).toBe('2 hrs');
    expect(e.heightGain).toBe('530m');
  });
  it('marks entries with a stats table or labelled grade as full', () => {
    const { index } = transform(raw);
    expect(index[0].isFullEntry).toBe(true);
    expect(index[1].isFullEntry).toBe(false);
  });
  it('relates other routes sharing the same area path, excluding itself', () => {
    const kast = transform(raw).content.find((c) => c.id === 'tm--aw--kasteelspoort')!;
    expect(kast.related).toEqual([{ id: 'tm--aw--other', title: 'Other' }]);
  });
  it('counts photos without downloading any', () => {
    expect(transform(raw).content[0].photoCount).toBe(3);
  });
  it('produces globally unique ids', () => {
    const ids = transform(raw).index.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
