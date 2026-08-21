/**
 * A plan in a URL, so it survives a reload and can be sent to whoever is
 * coming along.
 *
 * Short keys because segment ids are already long; URLSearchParams handles the
 * slashes and double hyphens they contain without any escaping of our own.
 */

import type { PlanChoice } from './plan';

export function encodePlan(choice: PlanChoice): URLSearchParams {
  const params = new URLSearchParams();
  // Empty slots are OMITTED, not written blank: an absent key means "no
  // preference", which resolvePlan answers with the default. A blank value
  // would be indistinguishable from asking for nothing at all.
  if (choice.approach) params.set('a', choice.approach);
  if (choice.main) params.set('m', choice.main);
  if (choice.exit) params.set('x', choice.exit);
  if (choice.reversed) params.set('rev', '1');
  return params;
}

export function decodePlan(params: URLSearchParams): Partial<PlanChoice> {
  const out: Partial<PlanChoice> = { reversed: params.get('rev') === '1' };
  const a = params.get('a');
  const m = params.get('m');
  const x = params.get('x');
  if (a) out.approach = a;
  if (m) out.main = m;
  if (x) out.exit = x;
  return out;
}
