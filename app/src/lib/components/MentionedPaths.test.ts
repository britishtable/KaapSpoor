import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import MentionedPaths from './MentionedPaths.svelte';

describe('MentionedPaths', () => {
  it('states the relation exactly — mentions, not the route', () => {
    // The map draws these as "paths the text refers to", which includes escape
    // routes and paths merely crossed. Wording that implied "the route" would
    // assert something we cannot know.
    render(MentionedPaths, { names: ['Contour Path'] });
    expect(screen.getByText('Paths this description names')).toBeTruthy();
    expect(screen.queryByText(/the route/i)).toBeNull();
  });

  it('lists every name, in the order given', () => {
    render(MentionedPaths, { names: ['Pipe Track', 'Contour Path', 'India Venster'] });
    const items = screen.getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(items).toEqual(['Pipe Track', 'Contour Path', 'India Venster']);
  });

  it('says so when a description names none, rather than rendering nothing', () => {
    // 32 of the 133 in-region routes name no mapped path. An empty gap would
    // read as broken to someone who just saw highlights on another route.
    render(MentionedPaths, { names: [] });
    expect(screen.getByText('No mapped paths are named in this description.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a name that contains markup characters as text', () => {
    // Titles from the crawl already contain raw "&"; OSM names are equally
    // untrusted text.
    render(MentionedPaths, { names: ['<script>x</script> Ravine'] });
    expect(screen.getByText('<script>x</script> Ravine')).toBeTruthy();
  });
});
