export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function routeId(area: string[], slug: string): string {
  return slugify([...area, slug].join('-'));
}
