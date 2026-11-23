import type { Category } from './types';

/** The eight report categories in the order a reader is offered them, with their labels. */
export const CATEGORIES: readonly Category[] = [
	'OBSTRUCTION', 'TRAIL_DAMAGE', 'CLOSURE', 'FIRE', 'WATER', 'WILDLIFE', 'SAFETY', 'CONDITIONS'
];

export const CATEGORY_LABELS: Record<Category, string> = {
	OBSTRUCTION: 'Obstruction (fallen tree, rockfall)',
	TRAIL_DAMAGE: 'Trail damage or erosion',
	CLOSURE: 'Closure',
	FIRE: 'Fire or fire damage',
	WATER: 'Water source',
	WILDLIFE: 'Wildlife (e.g. baboons)',
	SAFETY: 'Safety incident',
	CONDITIONS: 'Mud, flooding or snow'
};

export const SAFETY_GUIDANCE = "Describe what happened and where. Please don't name or describe the people involved.";
export const NOTE_MAX = 500;
