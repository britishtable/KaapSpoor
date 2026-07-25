export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function routeId(area: string[], slug: string): string {
  // Slugify each segment, then join with '--'. A slugified segment can never
  // contain '--' (slugify collapses runs of non-alphanumerics to a single '-'),
  // so distinct (area, slug) inputs cannot collide across a shared hyphen
  // boundary. This id is the journal's persistence key and must survive
  // re-crawls, so collision-freedom matters more than pretty URLs.
  return [...area, slug].map(slugify).join('--');
}
