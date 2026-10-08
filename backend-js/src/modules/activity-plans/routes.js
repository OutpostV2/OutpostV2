import { createHash, randomUUID } from 'node:crypto';
import Busboy from 'busboy';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, conflict, notFound, notReady } from '../../core/errors.js';
import { LEARNING_RESOURCE_ROLES, requireOrganizationRole } from '../../core/authorization.js';
import { PDF_LIMITS } from './parser.js';
import { sourceKey } from './storage.js';

const uuid = z.string().uuid();
const id = z.string().min(1).max(100);
const title = z.string().trim().min(2).max(200);
const topic = z.strictObject({
  id, title, description: z.string().max(1000), source_refs: z.array(id).max(200),
});
const week = z.strictObject({ id, title, topics: z.array(topic).max(24) });
const phase = z.strictObject({ id, title, weeks: z.array(week).max(52) });
const proposalSchema = z.strictObject({ phases: z.array(phase).max(12) });
const reviewItem = z.strictObject({
  id, page_number: z.number().int().min(1).max(PDF_LIMITS.max_pages),
  text: z.string(), disposition: z.enum(['unresolved', 'included', 'excluded']),
  topic_id: id.nullable(), reason: z.string().max(1000),
});
const reviewInput = z.strictObject({
  revision: z.number().int().positive(), name: title, proposal: proposalSchema,
  review_items: z.array(reviewItem).max(10_000), review_confirmed: z.boolean(),
});
const revisionInput = z.strictObject({ revision: z.number().int().positive() });

function parse(schema, value, location = 'body') {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(422, 'validation_error', 'Request validation failed',
    result.error.issues.map((issue) => ({ loc: [location, ...issue.path], type: issue.code })));
}
const pathId = (request, key) => parse(uuid, request.params[key], 'path');
const staff = (prisma, request, organizationId) =>
  requireOrganizationRole(prisma, request.user, organizationId, LEARNING_RESOURCE_ROLES);

function output(plan) {
  return {
    id: plan.id, organization_id: plan.organizationId, name: plan.name,
    filename: plan.filename, status: plan.status, page_count: plan.pageCount,
    failure: plan.failure ?? null, revision: plan.revision,
    created_at: plan.createdAt, updated_at: plan.updatedAt,
    pages: plan.pages ?? [], proposal: plan.proposal ?? { phases: [] },
    review_items: plan.reviewItems ?? [], warnings: plan.warnings ?? [],
    review_confirmed: plan.reviewConfirmed,
    roadmap_id: plan.roadmapId, version_id: plan.versionId,
  };
}

async function scoped(prisma, organizationId, planId) {
  const plan = await prisma.activityPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.organizationId !== organizationId) throw notFound('Activity plan not found');
  return plan;
}

function cleanFilename(value) {
  const filename = String(value || 'activity-plan.pdf').split(/[\\/]/).at(-1)
    .replace(/[\x00-\x1f\x7f";]/g, '_').slice(0, 255);
  return filename || 'activity-plan.pdf';
}

function readUpload(request) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({ headers: request.headers, limits: {
        files: 1, fields: 1, parts: 3, fileSize: PDF_LIMITS.max_bytes,
        fieldSize: 200, fieldNameSize: 32,
      } });
    } catch {
      reject(new AppError(415, 'unsupported_media_type', 'Use multipart/form-data with one PDF file.'));
      return;
    }
    let name = '';
    let filename = '';
    let bytes = null;
    let rejected = null;
    let fileCount = 0;
    const fail = (error) => { rejected ||= error; };
    parser.on('field', (key, value, info) => {
      if (key !== 'name' || info.valueTruncated) fail(new AppError(422, 'validation_error', 'Enter a plan name of 2–200 characters.'));
      else name = value.trim();
    });
    parser.on('file', (key, stream, info) => {
      fileCount += 1;
      if (key !== 'file' || !['application/pdf', 'application/octet-stream'].includes(info.mimeType)) {
        fail(new AppError(415, 'unsupported_media_type', 'Upload a PDF file.'));
      }
      filename = cleanFilename(info.filename);
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size <= PDF_LIMITS.max_bytes) chunks.push(chunk);
      });
      stream.on('limit', () => fail(new AppError(413, 'pdf_too_large', 'PDF exceeds the 10 MiB limit.')));
      stream.on('end', () => { bytes = Buffer.concat(chunks); });
    });
    parser.on('filesLimit', () => fail(new AppError(422, 'validation_error', 'Upload exactly one PDF file.')));
    parser.on('fieldsLimit', () => fail(new AppError(422, 'validation_error', 'Only a plan name is accepted.')));
    parser.on('partsLimit', () => fail(new AppError(422, 'validation_error', 'Upload one name and one PDF.')));
    parser.on('error', () => fail(new AppError(400, 'bad_request', 'The upload could not be read.')));
    parser.on('close', () => {
      if (rejected) return reject(rejected);
      if (fileCount !== 1 || !bytes || bytes.length < 5 || bytes.subarray(0, 5).toString() !== '%PDF-') {
        return reject(new AppError(422, 'pdf_invalid', 'Upload a valid PDF file.'));
      }
      const parsedName = title.safeParse(name);
      if (!parsedName.success) return reject(new AppError(422, 'validation_error', 'Enter a plan name of 2–200 characters.'));
      resolve({ name: parsedName.data, filename, bytes });
    });
    request.pipe(parser);
  });
}

function checkReview(source, input) {
  const original = new Map(source.reviewItems.map((item) => [item.id, item]));
  const seen = new Set();
  if (input.review_items.length !== original.size) throw conflict('Review decisions must cover every source line.');
  for (const item of input.review_items) {
    const prior = original.get(item.id);
    if (!prior || seen.has(item.id) || item.text !== prior.text || item.page_number !== prior.page_number) {
      throw conflict('Source lines cannot be changed.');
    }
    seen.add(item.id);
    if (item.disposition === 'excluded' && item.reason.trim().length < 2) {
      throw new AppError(422, 'validation_error', 'Explain why excluded source text is irrelevant.');
    }
  }
  const nodeIds = new Set();
  const topicIds = new Set();
  const topicRefs = new Map();
  let count = 0;
  for (const phase of input.proposal.phases) {
    if (nodeIds.has(phase.id)) throw conflict('Proposal IDs must be unique.');
    nodeIds.add(phase.id);
    for (const week of phase.weeks) {
      if (nodeIds.has(week.id)) throw conflict('Proposal IDs must be unique.');
      nodeIds.add(week.id);
      for (const topic of week.topics) {
        if (nodeIds.has(topic.id)) throw conflict('Proposal IDs must be unique.');
        nodeIds.add(topic.id);
        topicIds.add(topic.id);
        topicRefs.set(topic.id, new Set(topic.source_refs));
        count += 1;
        for (const ref of topic.source_refs) if (!original.has(ref)) throw conflict('Topic source reference is invalid.');
      }
    }
  }
  if (count > 500) throw new AppError(422, 'validation_error', 'A draft can contain at most 500 topics.');
  for (const item of input.review_items) {
    if (item.topic_id && !topicIds.has(item.topic_id)) throw conflict('Review item points to a missing topic.');
    if (item.disposition !== 'included' && item.topic_id) throw conflict('Only included source text can link to a topic.');
    if (item.disposition === 'included' &&
        !/^(?:module|phase|week|session)\s+\d+[\s.:–-]+/i.test(item.text) &&
        (!item.topic_id || !topicRefs.get(item.topic_id)?.has(item.id))) {
      throw new AppError(422, 'validation_error', 'Link included source text to a topic or exclude it with a reason.');
    }
  }
  if (input.review_confirmed && input.review_items.some((item) => item.disposition === 'unresolved')) {
    throw new AppError(422, 'validation_error', 'Resolve or exclude every source line before confirming review.');
  }
}

function complete(proposal) {
  return proposal.phases.length > 0 && proposal.phases.every((phase) =>
    phase.weeks.length > 0 && phase.weeks.every((week) => week.topics.length > 0));
}

export function registerActivityPlanRoutes(app, { prisma, requireUser, storage }) {
  const base = '/api/v1/organizations/:organizationId/activity-plans';
  const one = `${base}/:planId`;
  const requireStorage = () => { if (!storage) throw notReady('Activity-plan storage is not configured'); };

  app.get(base, requireUser, async (request, response) => {
    const organizationId = pathId(request, 'organizationId');
    await staff(prisma, request, organizationId);
    const plans = await prisma.activityPlan.findMany({
      where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    response.json({ plans: plans.map(output), limits: PDF_LIMITS });
  });

  app.post(base, requireUser, async (request, response) => {
    const organizationId = pathId(request, 'organizationId');
    await staff(prisma, request, organizationId);
    requireStorage();
    const input = await readUpload(request);
    const planId = randomUUID();
    const key = sourceKey(organizationId, planId);
    await storage.putSource(key, input.bytes);
    let plan;
    try {
      plan = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
        await staff(tx, request, organizationId);
        return tx.activityPlan.create({ data: {
          id: planId, organizationId, uploadedBy: request.user.id,
          name: input.name, filename: input.filename, objectKey: key,
          sha256: createHash('sha256').update(input.bytes).digest('hex'),
          byteCount: input.bytes.length,
        } });
      });
    } catch (error) {
      await storage.deleteSource(key).catch(() => {});
      throw error;
    }
    response.status(201).json(output(plan));
  });

  app.get(one, requireUser, async (request, response) => {
    const organizationId = pathId(request, 'organizationId');
    await staff(prisma, request, organizationId);
    response.json(output(await scoped(prisma, organizationId, pathId(request, 'planId'))));
  });

  app.get(`${one}/source`, requireUser, async (request, response) => {
    const organizationId = pathId(request, 'organizationId');
    await staff(prisma, request, organizationId);
    const plan = await scoped(prisma, organizationId, pathId(request, 'planId'));
    requireStorage();
    let bytes;
    try { bytes = await storage.getSource(plan.objectKey); }
    catch { throw notReady('Source PDF is temporarily unavailable'); }
    response.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cleanFilename(plan.filename)}"`,
    }).send(bytes);
  });

  app.patch(one, requireUser, async (request, response) => {
    const organizationId = pathId(request, 'organizationId');
    const planId = pathId(request, 'planId');
    const input = parse(reviewInput, request.body);
    await staff(prisma, request, organizationId);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM activity_plans WHERE id = ${planId}::uuid FOR UPDATE`;
      await staff(tx, request, organizationId);
      const current = await scoped(tx, organizationId, planId);
      if (current.status !== 'ready') throw conflict('Only ready activity plans can be reviewed.');
      if (current.revision !== input.revision) throw conflict('This plan changed. Reload before saving.');
      checkReview(current, input);
      return tx.activityPlan.update({
        where: { id: planId }, data: {
          name: input.name, proposal: input.proposal, reviewItems: input.review_items,
          reviewConfirmed: input.review_confirmed, revision: { increment: 1 }, updatedAt: new Date(),
        },
      });
    });
    response.json(output(plan));
  });

  app.post(`${one}/retry`, requireUser, async (request, response) => {
    const organizationId = pathId(request, 'organizationId');
    const planId = pathId(request, 'planId');
    const { revision } = parse(revisionInput, request.body);
    await staff(prisma, request, organizationId);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM activity_plans WHERE id = ${planId}::uuid FOR UPDATE`;
      await staff(tx, request, organizationId);
      const current = await scoped(tx, organizationId, planId);
      if (current.status !== 'failed') throw conflict('Only failed plans can be retried.');
      if (current.revision !== revision) throw conflict('This plan changed. Reload before retrying.');
      return tx.activityPlan.update({
        where: { id: planId }, data: {
          status: 'queued', failure: Prisma.DbNull, processingStartedAt: null,
          revision: { increment: 1 }, updatedAt: new Date(),
        },
      });
    });
    response.json(output(plan));
  });

  app.post(`${one}/convert`, requireUser, async (request, response) => {
    const organizationId = pathId(request, 'organizationId');
    const planId = pathId(request, 'planId');
    const { revision } = parse(revisionInput, request.body);
    await staff(prisma, request, organizationId);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM activity_plans WHERE id = ${planId}::uuid FOR UPDATE`;
      await staff(tx, request, organizationId);
      const current = await scoped(tx, organizationId, planId);
      if (current.status === 'converted' && current.roadmapId && current.versionId) {
        return { roadmap_id: current.roadmapId, version_id: current.versionId, version_number: 1, repeated: true };
      }
      if (current.status !== 'ready') throw conflict('The activity plan is not ready to convert.');
      if (current.revision !== revision) throw conflict('This plan changed. Reload before converting.');
      if (!current.reviewConfirmed || !complete(current.proposal) ||
          current.reviewItems.some((item) => item.disposition === 'unresolved')) {
        throw new AppError(422, 'validation_error', 'Complete the source review and learning outline before converting.');
      }
      const roadmap = await tx.roadmap.create({ data: {
        organizationId, name: current.name, description: '', createdBy: request.user.id,
      } });
      const version = await tx.roadmapVersion.create({ data: {
        roadmapId: roadmap.id, versionNumber: 1, status: 'draft', createdBy: request.user.id,
      } });
      for (const [phaseIndex, phase] of current.proposal.phases.entries()) {
        const phaseRow = await tx.phase.create({ data: {
          roadmapVersionId: version.id, title: phase.title, orderIndex: phaseIndex + 1,
        } });
        for (const [weekIndex, week] of phase.weeks.entries()) {
          const weekRow = await tx.week.create({ data: {
            phaseId: phaseRow.id, title: week.title, orderIndex: weekIndex + 1,
          } });
          for (const [topicIndex, topic] of week.topics.entries()) {
            await tx.topic.create({ data: {
              weekId: weekRow.id, title: topic.title, description: topic.description,
              orderIndex: topicIndex + 1,
            } });
          }
        }
      }
      await tx.activityPlan.update({ where: { id: planId }, data: {
        status: 'converted', roadmapId: roadmap.id, versionId: version.id,
        revision: { increment: 1 }, updatedAt: new Date(),
      } });
      return { roadmap_id: roadmap.id, version_id: version.id, version_number: 1, repeated: false };
    }, { timeout: 30_000 });
    const { repeated, ...body } = result;
    response.status(repeated ? 200 : 201).json(body);
  });
}
