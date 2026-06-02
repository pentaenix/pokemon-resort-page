/** Group roadmap milestones into past / present / future buckets for UI. */
export const MILESTONE_ERAS = [
  {
    id: 'present',
    title: 'Now',
    subtitle: 'Where the project is focused today and what comes right after.',
    statuses: ['current', 'next'],
    collapsible: false,
  },
  {
    id: 'past',
    title: 'Past',
    subtitle: 'Completed steps in the build story.',
    statuses: ['past'],
    collapsible: true,
    defaultOpen: false,
  },
  {
    id: 'future',
    title: 'Ahead',
    subtitle: 'Later goals and paused ideas on the horizon.',
    statuses: ['future', 'paused'],
    collapsible: true,
    defaultOpen: false,
  },
];

const STATUS_TO_ERA = Object.fromEntries(
  MILESTONE_ERAS.flatMap((era) => era.statuses.map((status) => [status, era.id])),
);

export function groupMilestonesByEra(milestones = []) {
  const groups = { present: [], past: [], future: [], other: [] };
  milestones.forEach((item) => {
    const era = STATUS_TO_ERA[item.status] || 'other';
    groups[era].push(item);
  });
  if (groups.other.length) groups.future.push(...groups.other);
  return groups;
}

export function eraStatusLabel(status) {
  return (
    {
      past: 'Completed',
      current: 'Current',
      next: 'Up next',
      future: 'Future',
      paused: 'Paused',
    }[status] || status
  );
}
