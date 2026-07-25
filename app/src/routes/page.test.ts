import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Page from './+page.svelte';

describe('home', () => {
  it('shows the app name', () => {
    render(Page);
    expect(screen.getByRole('heading', { name: /KaapSpoor/i })).toBeTruthy();
  });
});
