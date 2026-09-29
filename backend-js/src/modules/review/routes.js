import { z } from 'zod';
import { AppError, notFound } from '../../core/errors.js';
import { requireAccountType } from '../../core/authorization.js';

const progressInput = z.strictObject({ completed: z.boolean() });
const roadmapTitle = 'Career Readiness Foundations';
const cohortTitle = 'Career Readiness · Example Cohort';
const phases = [
  { title: 'Find your direction', description: 'Understand your strengths and set a clear starting point.', topics: [
    ['goals', 'Set your career goals', 'Define two roles to explore and the skills they require.', 1],
    ['communication', 'Communicate with confidence', 'Practice a concise introduction and clear professional writing.', 2],
  ] },
  { title: 'Build your evidence', description: 'Turn learning into work you can show.', topics: [
    ['project', 'Complete a practical project', 'Create a small project that demonstrates your skills.', 3],
    ['portfolio', 'Present your work', 'Summarize your project in a portfolio-ready case study.', 4],
  ] },
  { title: 'Prepare for opportunities', description: 'Get ready to apply, interview, and improve.', topics: [
    ['resume', 'Refine your résumé', 'Connect your experience to a role with evidence.', 5],
    ['interview', 'Practice an interview', 'Rehearse responses and identify the next improvement.', 6],
  ] },
];
const topicKeys = new Set(phases.flatMap((phase) => phase.topics.map((topic) => topic[0])));
const samplePeers = [
  ['Anika Sharma', new Set(['goals', 'communication', 'project', 'portfolio', 'resume'])],
  ['Rohan Mehta', new Set(['goals', 'communication', 'project'])],
  ['Sara Khan', new Set(['goals'])],
];

function roundEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  return fraction > 0.5 || (fraction === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
}

function parseInput(value) {
  const result = progressInput.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(422, 'validation_error', 'Request validation failed',
    result.error.issues.map((issue) => ({
      loc: ['body', ...issue.path],
      type: issue.code === 'unrecognized_keys' ? 'extra_forbidden' : 'bool_type',
    })));
}

async function overview(prisma, user) {
  const rows = await prisma.reviewTopicProgress.findMany({ where: { userId: user.id } });
  const completed = new Map(rows.filter((row) => topicKeys.has(row.topicKey)).map((row) => [row.topicKey, row]));
  const allTopics = [];
  const phaseOutput = phases.map((phase) => {
    const topics = phase.topics.map(([key, title, description, week]) => {
      const row = completed.get(key);
      const topic = {
        key, title, description, week,
        status: row ? 'completed' : 'not_started',
        completed_at: row ? row.completedAt : null,
      };
      allTopics.push(topic);
      return topic;
    });
    return { title: phase.title, description: phase.description, topics };
  });
  const total = allTopics.length;
  const count = completed.size;
  const student = {
    roadmap_title: roadmapTitle,
    completed: count,
    total,
    percent: roundEven(count * 100 / total),
    next_topic: allTopics.find((topic) => topic.status === 'not_started') ?? null,
    phases: phaseOutput,
  };
  const members = [
    { name: user.display_name, completed: count, total, percent: student.percent, is_you: true },
    ...samplePeers.map(([name, keys]) => ({
      name, completed: keys.size, total, percent: roundEven(keys.size * 100 / total), is_you: false,
    })),
  ];
  const stats = phases.flatMap((phase) => phase.topics.map(([key, title]) => {
    const done = Number(completed.has(key)) + samplePeers.reduce((sum, [, keys]) => sum + Number(keys.has(key)), 0);
    return { title, completed: done, total: members.length, percent: roundEven(100 * done / members.length) };
  }));
  const coordinator = {
    cohort_title: cohortTitle,
    roadmap_title: roadmapTitle,
    members,
    average_percent: roundEven(members.reduce((sum, member) => sum + member.percent, 0) / members.length),
    topics: stats,
  };
  return { scenario: 'illustrative', student, coordinator: user.account_type === 'coordinator' ? coordinator : null };
}

export function registerReviewRoutes(app, { prisma, settings: _settings, requireUser }) {
  app.get('/api/v1/review/overview', requireUser, async (request, response) => {
    requireAccountType(request.user, ['student', 'coordinator']);
    response.set('Cache-Control', 'no-store');
    response.json(await overview(prisma, request.user));
  });

  app.put('/api/v1/review/progress/:topicKey', requireUser, async (request, response) => {
    requireAccountType(request.user, ['student']);
    if (!topicKeys.has(request.params.topicKey)) throw notFound('Review topic not found');
    const data = parseInput(request.body);
    if (data.completed) {
      await prisma.reviewTopicProgress.createMany({
        data: [{ userId: request.user.id, topicKey: request.params.topicKey }],
        skipDuplicates: true,
      });
    } else {
      await prisma.reviewTopicProgress.deleteMany({
        where: { userId: request.user.id, topicKey: request.params.topicKey },
      });
    }
    response.set('Cache-Control', 'no-store');
    response.json(await overview(prisma, request.user));
  });

  app.delete('/api/v1/review/progress', requireUser, async (request, response) => {
    requireAccountType(request.user, ['student']);
    await prisma.reviewTopicProgress.deleteMany({ where: { userId: request.user.id } });
    response.set('Cache-Control', 'no-store').status(204).end();
  });
}
