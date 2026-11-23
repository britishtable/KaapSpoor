import type { Answer, Category } from './types';

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

/**
 * Pin and stripe colour per kind of report, so the map and the list agree at a glance: the way
 * itself (blocked, damaged, closed, burnt), water and wet ground, animals, and people. Mid-tone
 * and calm on purpose, safety included: nothing here is an alarm red.
 */
export const CATEGORY_COLOURS: Record<Category, string> = {
	OBSTRUCTION: '#b45309',
	TRAIL_DAMAGE: '#b45309',
	CLOSURE: '#b45309',
	FIRE: '#b45309',
	WATER: '#0369a1',
	CONDITIONS: '#0369a1',
	WILDLIFE: '#4d7c0f',
	SAFETY: '#6d28d9'
};

/** The three answers to "is it still there?", in the order they are offered. */
export const ANSWERS: readonly { value: Answer; label: string }[] = [
	{ value: 'STILL_THERE', label: 'Still there' },
	{ value: 'GONE', label: 'Gone' },
	{ value: 'NOT_SURE', label: 'Not sure' }
];
export const ANSWER_WORDS: Record<Answer, string> = { STILL_THERE: 'Still there', GONE: 'Gone', NOT_SURE: 'Not sure' };
