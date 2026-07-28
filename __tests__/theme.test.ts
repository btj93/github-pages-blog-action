import { beforeAll, describe, expect, test } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prepareTheme } from '../src/theme';
import { ConfigurationType } from '../src/git';

const fixtureRepo = path.join(__dirname, 'fixtures', 'blog');

type RenderedPost = {
  className: string;
  title: string;
  href?: string;
  dataPublish?: string;
  dataHref?: string;
  dataTarget?: string;
  datetime?: string;
};

function attr(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`\\s${name}="([^"]*)"`));

  return match ? match[1] : undefined;
}

function parsePosts(indexHtml: string): RenderedPost[] {
  const blocks = indexHtml.match(/<a class="post[\s\S]*?<\/a>/g) || [];

  return blocks.map(block => ({
    className: attr(block, 'class') || '',
    title: (block.match(/<span class="post__title">([^<]*)<\/span>/) || [])[1] || '',
    href: attr(block, 'href'),
    dataPublish: attr(block, 'data-publish'),
    dataHref: attr(block, 'data-href'),
    dataTarget: attr(block, 'data-target'),
    datetime: attr(block, 'datetime')
  }));
}

describe('prepareTheme homepage generation', () => {
  let outputDir: string;
  let indexHtml: string;
  let posts: RenderedPost[];

  beforeAll(async () => {
    outputDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blog-action-')), 'out');

    const configuration = {
      repoPath: fixtureRepo,
      outputDir,
      pusherName: 'test',
      pusherEmail: 'test@example.com',
      repoUrl: '',
      token: '',
      repositoryName: 'fixture',
      hostname: 'github.com',
      branch: 'gh-pages',
      themeDir: ''
    } as ConfigurationType;

    await prepareTheme(configuration);

    indexHtml = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf-8');
    posts = parsePosts(indexHtml);
  }, 30000);

  test('orders every post newest first, by full date rather than day of month', () => {
    // March 2020 must precede January 2020 even though its day of month is
    // smaller, and the years must descend. Fixture filenames are deliberately
    // in a different order, so an ineffective sort cannot pass this.
    expect(posts.map(post => post.dataPublish)).toEqual([
      '2999-12-25',
      '2999-01-01',
      '2020-03-05',
      '2020-01-30',
      '2019-11-12'
    ]);
  });

  test('skips posts that have no date in their front matter', () => {
    expect(indexHtml).not.toContain('Undated and therefore ignored');
    expect(posts).toHaveLength(5);
  });

  test('marks future-dated posts as drafts with no href, but keeps the destination', () => {
    const drafts = posts.filter(post => post.className.split(' ').includes('draft'));

    expect(drafts.map(post => post.dataPublish)).toEqual(['2999-12-25', '2999-01-01']);

    drafts.forEach(draft => {
      // No href means the anchor is inert and unfocusable until promoted.
      expect(draft.href).toBeUndefined();
      expect(draft.dataHref).toBe(draft.dataPublish === '2999-01-01' ? '/jan-2999' : '/dec-2999');
      expect(draft.dataTarget).toBe('_self');
    });
  });

  test('renders past-dated posts as ordinary links', () => {
    const published = posts.filter(post => !post.className.split(' ').includes('draft'));

    expect(published.map(post => post.className)).toEqual(['post', 'post', 'post']);
    expect(published.map(post => post.href)).toEqual(['/mar-2020', '/jan-2020', '/nov-2019']);
    expect(published.map(post => post.dataHref)).toEqual(['/mar-2020', '/jan-2020', '/nov-2019']);
  });

  test('emits a machine-readable datetime matching the publish date', () => {
    posts.forEach(post => {
      expect(post.datetime).toBe(post.dataPublish);
    });

    // The previous template hardcoded this placeholder on every entry.
    expect(indexHtml).not.toContain('2018-12-04');
  });

  test('still renders the human-readable date for readers', () => {
    expect(indexHtml).toContain('Thu, January 30, 2020');
  });

  test('includes the script that promotes drafts whose date has arrived', () => {
    expect(indexHtml).toContain('a.post.draft[data-publish]');
  });

  test('emits a machine-readable datetime on the post page too', () => {
    const postHtml = fs.readFileSync(path.join(outputDir, 'jan-2020.html'), 'utf-8');

    expect(postHtml).toContain('datetime="2020-01-30"');
    expect(postHtml).toContain('Thu, January 30, 2020');
  });

  test('builds a page for future-dated posts as well', () => {
    // Drafts are hidden from the index, not withheld from the site. This is
    // pre-existing behaviour and the client-side promotion relies on it.
    expect(fs.existsSync(path.join(outputDir, 'jan-2999.html'))).toBe(true);
  });
});
