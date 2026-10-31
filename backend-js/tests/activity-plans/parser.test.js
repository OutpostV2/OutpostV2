import { PDFDocument, PDFName, PDFHexString, StandardFonts } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { extractActivityPlan } from '../../src/modules/activity-plans/parser.js';

async function pdf(pages, { width = 612, size = 12 } = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = document.addPage([width, 792]);
    lines.forEach((line, index) => page.drawText(line, {
      x: 48, y: 744 - index * 22, size, font,
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
    await expect(extractActivityPlan(new TextEncoder().encode('%PDF-1.7\nmalformed document'))).rejects.toMatchObject({ code: 'pdf_invalid' });
  });

  test('returns an actionable encrypted-PDF failure', async () => {
    const document = await PDFDocument.load(await pdf([['Private source']]));
    document.context.trailerInfo.Encrypt = document.context.register(document.context.obj({
      Filter: PDFName.of('Standard'), V: 1, R: 2, Length: 40,
      O: PDFHexString.of('00'.repeat(32)), U: PDFHexString.of('00'.repeat(32)), P: -4,
    }));
    await expect(extractActivityPlan(new Uint8Array(await document.save({ useObjectStreams: false }))))
      .rejects.toMatchObject({ code: 'pdf_encrypted' });
  });

  test('preserves Unicode and keeps uncertain table rows unresolved', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('1. Café reflection', { x: 40, y: 700, size: 12, font });
    page.drawText('2. Portfolio review', { x: 340, y: 700, size: 12, font });
    const result = await extractActivityPlan(new Uint8Array(await document.save()));
    expect(result.pages[0].text).toContain('Café');
    expect(result.review_items[0].disposition).toBe('unresolved');
    expect(result.warnings.some((warning) => /table|column/i.test(warning.message))).toBe(true);
  });

  test('rejects more than 50 pages before producing a proposal', async () => {
    await expect(extractActivityPlan(await pdf(Array.from({ length: 51 }, () => ['Text']))))
      .rejects.toMatchObject({ code: 'pdf_too_many_pages' });
  });

  test('marks repeated page furniture unresolved instead of adding it to activity descriptions', async () => {
    const result = await extractActivityPlan(await pdf([
      ['Campus activity plan', 'Module 1: Foundations', 'Week 1: Orientation', '1. Set goals', 'Internal use only'],
      ['Campus activity plan', '2. Build evidence', 'Internal use only'],
    ]));
    const repeated = result.review_items.filter((item) => ['Campus activity plan', 'Internal use only'].includes(item.text));
    expect(repeated).toHaveLength(4);
    expect(repeated.every((item) => item.disposition === 'unresolved')).toBe(true);
    expect(result.warnings.some((warning) => /repeated/i.test(warning.message))).toBe(true);
    expect(result.proposal.phases[0].weeks[0].topics[0].description).not.toContain('Internal use only');
  });

  test('provides a marked empty suggested grouping for unstructured text', async () => {
    const result = await extractActivityPlan(await pdf([['Unstructured source notes.']]));
    expect(result.proposal.phases[0]).toMatchObject({ title: 'Suggested phase', weeks: [{ title: 'Suggested week', topics: [] }] });
    expect(result.review_items[0].disposition).toBe('unresolved');
  });

  test('rejects byte/text limits without truncation and flags mixed blank pages', async () => {
    await expect(extractActivityPlan(new Uint8Array(10 * 1024 * 1024 + 1)))
      .rejects.toMatchObject({ code: 'pdf_too_large' });
    const longLine = 'x'.repeat(5000);
    await expect(extractActivityPlan(await pdf(Array.from({ length: 41 }, () => [longLine]), { width: 4000, size: 1 })))
      .rejects.toMatchObject({ code: 'pdf_too_much_text' });
    const mixed = await extractActivityPlan(await pdf([['1. Real activity'], []]));
    expect(mixed.warnings.some((warning) => warning.page_number === 2 && /no selectable text/i.test(warning.message))).toBe(true);
  });
});
