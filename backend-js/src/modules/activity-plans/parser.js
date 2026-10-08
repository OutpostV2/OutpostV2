import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const PDF_LIMITS = Object.freeze({
  max_bytes: 10 * 1024 * 1024,
  max_pages: 50,
  max_characters: 200_000,
});

export class ActivityPlanPdfError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ActivityPlanPdfError';
    this.code = code;
  }
}

const stableId = (kind, page, index, text) =>
  `${kind}-${createHash('sha256').update(`${page}\0${index}\0${text}`).digest('hex').slice(0, 20)}`;

function linesFromItems(items) {
  const positioned = items.filter((item) => typeof item.str === 'string' && item.str.trim())
    .map((item, index) => ({
      text: item.str.trim(), x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0), index,
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
  const lines = [];
  for (const item of positioned) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - item.y) <= 2) {
      line.text += `${item.x > line.lastX + 2 ? ' ' : ''}${item.text}`;
      line.lastX = item.x + item.text.length * 5;
    } else {
      lines.push({ text: item.text, y: item.y, lastX: item.x + item.text.length * 5 });
    }
  }
  return lines.map((line) => line.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function suggestStructure(pages) {
  const proposal = { phases: [] };
  const review_items = [];
  const warnings = [];
  let phase = null;
  let week = null;
  let topic = null;
  const addWarning = (page, item, message) => warnings.push({
    id: stableId('warning', page, warnings.length, message), message,
    page_number: page, review_item_id: item?.id ?? null,
  });

  for (const page of pages) {
    for (const [index, line] of page.lines.entries()) {
      const item = {
        id: stableId('line', page.page_number, index, line.text),
        page_number: page.page_number, text: line.text,
        disposition: 'unresolved', topic_id: null, reason: '',
      };
      review_items.push(item);
      const module = line.text.match(/^(?:module|phase)\s+\d+[\s.:–-]+(.+)$/i);
      const session = line.text.match(/^(?:week|session)\s+\d+[\s.:–-]+(.+)$/i);
      const activity = line.text.match(/^(?:activity|lab|exercise)\s+\d+[\s.:–-]+(.+)$|^\d+[.)]\s+(.+)$/i);
      if (module) {
        phase = { id: stableId('phase', page.page_number, index, line.text), title: module[1].trim(), weeks: [] };
        proposal.phases.push(phase);
        week = null;
        topic = null;
        item.disposition = 'included';
      } else if (session) {
        if (!phase) {
          phase = { id: stableId('phase', 0, 0, 'Suggested phase'), title: 'Suggested phase', weeks: [] };
          proposal.phases.push(phase);
          addWarning(page.page_number, item, 'No explicit module heading; review the suggested phase.');
        }
        week = { id: stableId('week', page.page_number, index, line.text), title: session[1].trim(), topics: [] };
        phase.weeks.push(week);
        topic = null;
        item.disposition = 'included';
      } else if (activity) {
        if (!phase) {
          phase = { id: stableId('phase', 0, 0, 'Suggested phase'), title: 'Suggested phase', weeks: [] };
          proposal.phases.push(phase);
          addWarning(page.page_number, item, 'No explicit module heading; review the suggested phase.');
        }
        if (!week) {
          week = { id: stableId('week', page.page_number, index, 'Suggested week'), title: 'Suggested week', topics: [] };
          phase.weeks.push(week);
          addWarning(page.page_number, item, 'No explicit week heading; review the suggested week.');
        }
        topic = {
          id: stableId('topic', page.page_number, index, line.text),
          title: (activity[1] || activity[2]).trim(), description: '', source_refs: [item.id],
        };
        week.topics.push(topic);
        item.disposition = 'included';
        item.topic_id = topic.id;
      } else if (topic) {
        topic.description += `${topic.description ? '\n' : ''}${line.text}`;
        topic.source_refs.push(item.id);
        item.disposition = 'included';
        item.topic_id = topic.id;
      } else {
        addWarning(page.page_number, item, 'Unclassified source text needs a review decision.');
      }
    }
  }
  return { proposal, review_items, warnings };
}

export async function extractActivityPlan(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength > PDF_LIMITS.max_bytes) {
    throw new ActivityPlanPdfError('pdf_too_large', 'PDF exceeds the 10 MiB limit.');
  }
  if (data.byteLength < 5 || new TextDecoder().decode(data.subarray(0, 5)) !== '%PDF-') {
    throw new ActivityPlanPdfError('pdf_invalid', 'The file is not a valid PDF.');
  }
  let document;
  let task;
  try {
    task = getDocument({
      data: new Uint8Array(data), useSystemFonts: true,
      isEvalSupported: false, stopAtErrors: true,
    });
    document = await task.promise;
    if (document.numPages > PDF_LIMITS.max_pages) {
      throw new ActivityPlanPdfError('pdf_too_many_pages', 'PDF exceeds the 50-page limit.');
    }
    const pages = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const strings = linesFromItems(content.items);
      const text = strings.join('\n');
      characterCount += text.length;
      if (characterCount > PDF_LIMITS.max_characters) {
        throw new ActivityPlanPdfError('pdf_too_much_text', 'PDF exceeds the 200,000-character limit.');
      }
      pages.push({
        page_number: pageNumber, text,
        lines: strings.map((line, index) => ({ id: stableId('line', pageNumber, index, line), text: line })),
      });
      page.cleanup();
    }
    if (!characterCount) {
      throw new ActivityPlanPdfError('pdf_no_text', 'This PDF has no selectable text. Upload a text-based PDF.');
    }
    const suggested = suggestStructure(pages);
    for (const page of pages.filter((entry) => !entry.text)) {
      suggested.warnings.push({
        id: stableId('warning', page.page_number, 0, 'No selectable text'),
        message: 'This page has no selectable text and may need manual review.',
        page_number: page.page_number, review_item_id: null,
      });
    }
    return {
      page_count: pages.length, character_count: characterCount, pages,
      ...suggested,
    };
  } catch (error) {
    if (error instanceof ActivityPlanPdfError) throw error;
    if (error?.name === 'PasswordException') {
      throw new ActivityPlanPdfError('pdf_encrypted', 'Encrypted PDFs are not supported. Export an unlocked copy.');
    }
    throw new ActivityPlanPdfError('pdf_invalid', 'The PDF could not be read.');
  } finally {
    await task?.destroy();
  }
}
