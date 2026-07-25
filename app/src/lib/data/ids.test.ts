import { describe, it, expect } from 'vitest';
import { slugify, routeId } from './ids';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Table Mountain')).toBe('table-mountain');
  });
  it('collapses runs of non-alphanumerics and trims them', () => {
    expect(slugify("Corridor 'B' (+Rib)")).toBe('corridor-b-rib');
  });
});

describe('routeId', () => {
  it('joins the area path and slug deterministically', () => {
    expect(routeId(['Table-Mountain', 'atlantic-west'], 'kasteelspoort'))
      .toBe('table-mountain-atlantic-west-kasteelspoort');
  });
  it('disambiguates identical slugs in different areas', () => {
    const a = routeId(['cape-country', 'Winelands', 'jonkershoek'], 'klipspringer');
    const b = routeId(['cape-country', 'overberg'], 'klipspringer');
    expect(a).not.toBe(b);
  });
});
