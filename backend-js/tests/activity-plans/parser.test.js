import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { extractActivityPlan } from '../../src/modules/activity-plans/parser.js';

async function pdf(pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = document.addPage([612, 792]);
    lines.forEach((line, index) => page.drawText(line, {
      x: 48, y: 744 - index * 22, size: 12, font,
    }));
  }
  return new Uint8Array(await document.save());
}

describe('selectable-text activity plan extraction', () => {
  test('preserves source pages and proposes only explicit hierarchy', async () => {
    const result = await extractActivityPlan(await pdf([[
      'Module 1: Career foundations',
      'Week 1: Getting started',
      '1. Set goals',
      'Write a personal learning goal.',
      '2. Build a portfolio',
      'Collect evidence of your work.',
    ]]));
    expect(result.page_count).toBe(1);
    expect(result.pages[0].text).toContain('Write a personal learning goal.');
    expect(result.proposal.phases[0].title).toBe('Career foundations');
    expect(result.proposal.phases[0].weeks[0].title).toBe('Getting started');
    expect(result.proposal.phases[0].weeks[0].topics.map((topic) => topic.title))
      .toEqual(['Set goals', 'Build a portfolio']);
    expect(result.proposal.phases[0].weeks[0].topics[0].description)
      .toContain('Write a personal learning goal.');
    expect(result.review_items).toHaveLength(6);
    expect(result.review_items.every((item) => item.page_number === 1)).toBe(true);
  });

  test('keeps unmatched lines unresolved for human review', async () => {
    const result = await extractActivityPlan(await pdf([['Bring your own laptop.', 'Orientation notes.']]));
    expect(result.review_items.map((item) => item.disposition)).toEqual(['unresolved', 'unresolved']);
    expect(result.warnings.some((warning) => warning.review_item_id === result.review_items[0].id)).toBe(true);
  });

  test('rejects image-only and corrupt PDFs with distinct errors', async () => {
    await expect(extractActivityPlan(await pdf([[]]))).rejects.toMatchObject({ code: 'pdf_no_text' });
    await expect(extractActivityPlan(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'pdf_invalid' });
  });

  test('rejects more than 50 pages before producing a proposal', async () => {
    await expect(extractActivityPlan(await pdf(Array.from({ length: 51 }, () => ['Text']))))
      .rejects.toMatchObject({ code: 'pdf_too_many_pages' });
  });
});
