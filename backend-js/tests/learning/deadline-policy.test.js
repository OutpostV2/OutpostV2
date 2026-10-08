import { expect, it } from 'vitest';
import { weekStatus } from '../../src/modules/learning/activityRoutes.js';
it('uses strict due instants, missing dates and current completion without predicting lateness', () => {
  const dueAt=new Date('2026-11-01T06:30:00Z');const deadline={dueAt};
  expect(weekStatus(null,0,2,new Date('2027-01-01'))).toBe('unscheduled');
  expect(weekStatus(deadline,0,0,new Date('2027-01-01'))).toBe('no_topics');
  expect(weekStatus(deadline,2,2,new Date('2027-01-01'))).toBe('completed');
  expect(weekStatus(deadline,1,2,dueAt)).toBe('upcoming');
  expect(weekStatus(deadline,1,2,new Date(dueAt.getTime()+1))).toBe('overdue');
  // Fall-back local 01:30 occurs twice, but explicit offsets define distinct instants.
  expect(new Date('2026-11-01T01:30:00-04:00').getTime()).not.toBe(new Date('2026-11-01T01:30:00-05:00').getTime());
});
