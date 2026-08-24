import type {
  ClubFacilityProject,
  ClubStaffContract,
  ProfessionalLifecycleRecord,
  Room,
  RoomFixture,
} from '../../types';

export type CalendarItemKind = 'fixture' | 'facility-project' | 'staff-contract' | 'lifecycle';

interface CalendarItemBase {
  id: string;
  kind: CalendarItemKind;
  scheduledAt: string | null;
  title: string;
  detail: string;
}

export interface CalendarFixtureItem extends CalendarItemBase {
  kind: 'fixture';
  fixture: RoomFixture;
}

export interface CalendarCommitmentItem extends CalendarItemBase {
  kind: 'facility-project' | 'staff-contract' | 'lifecycle';
}

export type CalendarItem = CalendarFixtureItem | CalendarCommitmentItem;

export interface CalendarSchedule {
  items: CalendarItem[];
  fixtures: CalendarFixtureItem[];
  currentFixture: CalendarFixtureItem | null;
  otherItems: CalendarItem[];
}

const terminalStatuses = new Set(['cancelled', 'canceled', 'completed']);
const confirmedLifecycleStatuses = new Set(['signed', 'active']);

function normalizedId(value: unknown) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('pt-BR') : '';
}

export function sameCalendarClub(left: unknown, right: unknown) {
  const leftId = normalizedId(left);
  const rightId = normalizedId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

export function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function scheduledIso(value: unknown) {
  return validCalendarDate(value)?.toISOString() ?? null;
}

function itemStatus(value: unknown) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('pt-BR') : '';
}

function fixtureIsPending(fixture: RoomFixture, completedFixtureIds: Set<string>) {
  if (completedFixtureIds.has(normalizedId(fixture.fixtureId))) return false;
  const runtimeStatus = itemStatus((fixture as RoomFixture & { status?: unknown }).status);
  return !terminalStatuses.has(runtimeStatus);
}

function fixtureItem(fixture: RoomFixture): CalendarFixtureItem {
  return {
    id: `fixture:${fixture.fixtureId}`,
    kind: 'fixture',
    scheduledAt: scheduledIso(fixture.scheduledAt),
    title: `${fixture.homeTeam} × ${fixture.awayTeam}`,
    detail: fixture.competition,
    fixture,
  };
}

function facilityItem(project: ClubFacilityProject): CalendarCommitmentItem | null {
  const scheduledAt = scheduledIso(project.expectedAt);
  if (itemStatus(project.status) !== 'active' || !scheduledAt) return null;
  return {
    id: `facility-project:${project.id}`,
    kind: 'facility-project',
    scheduledAt,
    title: `Conclusão: ${project.name || 'Projeto de infraestrutura'}`,
    detail: project.category === 'stadium' ? 'Estádio' : 'Infraestrutura do clube',
  };
}

function staffContractItem(
  contract: ClubStaffContract,
  staffNames: Map<string, { name: string; role: string }>,
): CalendarCommitmentItem | null {
  const scheduledAt = scheduledIso(contract.endDate);
  if (itemStatus(contract.status) !== 'active' || !scheduledAt) return null;
  const staff = staffNames.get(normalizedId(contract.staffId));
  return {
    id: `staff-contract:${contract.id}`,
    kind: 'staff-contract',
    scheduledAt,
    title: `Fim do contrato · ${staff?.name || 'Comissão técnica'}`,
    detail: staff?.role || 'Contrato da comissão técnica',
  };
}

function lifecycleDate(record: ProfessionalLifecycleRecord) {
  if (itemStatus(record.kind) === 'retirement') {
    return scheduledIso(record.retirementAt ?? record.endsAt ?? record.effectiveAt);
  }
  return scheduledIso(record.endsAt ?? record.effectiveAt ?? record.retirementAt);
}

function lifecycleTitle(record: ProfessionalLifecycleRecord, professionalName: string | undefined) {
  const suffix = professionalName ? ` · ${professionalName}` : '';
  switch (itemStatus(record.kind)) {
    case 'retirement': return `Aposentadoria programada${suffix}`;
    case 'notice': return `Fim do aviso prévio${suffix}`;
    case 'mutual_agreement': return `Desligamento programado${suffix}`;
    case 'leave': return `Fim do afastamento${suffix}`;
    default: return `Compromisso profissional${suffix}`;
  }
}

function lifecycleItem(
  record: ProfessionalLifecycleRecord,
  staffNames: Map<string, { name: string; role: string }>,
): CalendarCommitmentItem | null {
  const scheduledAt = lifecycleDate(record);
  if (!confirmedLifecycleStatuses.has(itemStatus(record.status)) || !scheduledAt) return null;
  const staff = staffNames.get(normalizedId(record.professionalId));
  return {
    id: `lifecycle:${record.id}`,
    kind: 'lifecycle',
    scheduledAt,
    title: lifecycleTitle(record, staff?.name),
    detail: staff?.role || (record.professionalType === 'coach' ? 'Treinador' : 'Comissão técnica'),
  };
}

function compareCalendarItems(left: CalendarItem, right: CalendarItem) {
  const leftTime = validCalendarDate(left.scheduledAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightTime = validCalendarDate(right.scheduledAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  if (left.kind === 'fixture' && right.kind === 'fixture' && left.fixture.round !== right.fixture.round) {
    return left.fixture.round - right.fixture.round;
  }
  return left.id.localeCompare(right.id, 'pt-BR');
}

export function buildCalendarItems(room: Room | null, managerClubId: string | null): CalendarItem[] {
  if (!room || !normalizedId(managerClubId)) return [];

  const completedFixtureIds = new Set(
    (Array.isArray(room.completedFixtureIds) ? room.completedFixtureIds : []).map(normalizedId),
  );
  const fixtures = (Array.isArray(room.fixtureSchedule) ? room.fixtureSchedule : [])
    .filter((fixture) => (
      (sameCalendarClub(fixture.homeClubId, managerClubId) || sameCalendarClub(fixture.awayClubId, managerClubId))
      && fixtureIsPending(fixture, completedFixtureIds)
    ))
    .map(fixtureItem);

  const state = room.clubCareerState;
  if (!state) return fixtures.sort(compareCalendarItems);

  const staffNames = new Map(
    (Array.isArray(state.staffMembers) ? state.staffMembers : [])
      .filter((member) => sameCalendarClub(member.clubId, managerClubId))
      .map((member) => [normalizedId(member.id), { name: member.name, role: member.role }]),
  );
  const projects = (Array.isArray(state.facilityProjects) ? state.facilityProjects : [])
    .filter((project) => sameCalendarClub(project.clubId, managerClubId))
    .map(facilityItem)
    .filter((item): item is CalendarCommitmentItem => Boolean(item));
  const contracts = (Array.isArray(state.staffContracts) ? state.staffContracts : [])
    .filter((contract) => sameCalendarClub(contract.clubId, managerClubId))
    .map((contract) => staffContractItem(contract, staffNames))
    .filter((item): item is CalendarCommitmentItem => Boolean(item));
  const lifecycle = (Array.isArray(state.professionalLifecycle) ? state.professionalLifecycle : [])
    .filter((record) => sameCalendarClub(record.clubId, managerClubId))
    .map((record) => lifecycleItem(record, staffNames))
    .filter((item): item is CalendarCommitmentItem => Boolean(item));

  return [...fixtures, ...projects, ...contracts, ...lifecycle].sort(compareCalendarItems);
}

export function buildCalendarSchedule(room: Room | null, managerClubId: string | null): CalendarSchedule {
  const items = buildCalendarItems(room, managerClubId);
  const fixtures = items.filter((item): item is CalendarFixtureItem => item.kind === 'fixture');
  const currentFixtureId = normalizedId(room?.currentFixtureId);
  const currentFixture = fixtures.find((item) => normalizedId(item.fixture.fixtureId) === currentFixtureId)
    ?? fixtures[0]
    ?? null;
  return {
    items,
    fixtures,
    currentFixture,
    otherItems: currentFixture ? items.filter((item) => item.id !== currentFixture.id) : items,
  };
}
