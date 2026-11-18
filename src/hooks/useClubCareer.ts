import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emitSocketRequest } from '../lib/socketRequest';
import type {
  BolaSocket,
  ClubFacilityProject,
  ProfessionalAffiliationType,
  ProfessionalLifecycleAction,
  ProfessionalLifecycleRecord,
  Room,
} from '../types';

type RoomMutation = { room: Room };

export interface CareerStaffMember {
  id: string;
  name: string;
  role: string;
  roleLabel?: string;
  age: number;
  nationality: string;
  reputation: number;
  attributes: Record<string, number>;
  salary: number;
  clubId: string | null;
  contractId: string | null;
  specialties: string[];
  satisfaction: number;
  status: 'employed' | 'on_leave' | 'free_agent' | 'retired' | 'suspended';
  affiliationType?: ProfessionalAffiliationType;
  linkedCoachId?: string | null;
  linkedCoachName?: string | null;
  lifecycleStatus?: string | null;
  noticeEndsAt?: string | null;
  retirementAt?: string | null;
  interimAssignment?: {
    clubId: string;
    startsAt: string | null;
    endsAt: string | null;
    authorityLevel: number | null;
    status: string;
  } | null;
  /** Legacy read-only compatibility; new saves keep contracts in staffContracts. */
  contract?: { salary?: number } | null;
  professionalHistory: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export interface CareerStaffContract {
  id: string;
  staffId: string;
  clubId: string;
  startDate: string;
  endDate: string;
  startSeason: number;
  endSeason: number;
  wage: number;
  terminationRate: number;
  status: 'active' | 'expired' | 'terminated' | 'replaced';
  renewalCount: number;
  operationId: string | null;
  endedAt: string | null;
  endReason: string | null;
}

export interface CareerStaffPackageMemberInput {
  staffId: string;
  years?: number;
  wage?: number;
  signingBonus?: number;
  affiliationType?: ProfessionalAffiliationType;
}

interface RuntimeStaffState {
  staffMembers?: CareerStaffMember[];
  staffCandidates?: CareerStaffMember[];
  staffContracts?: CareerStaffContract[];
  staffEffectsByClub?: Record<string, Record<string, unknown>>;
  professionalLifecycle?: ProfessionalLifecycleRecord[];
  professionalTransitions?: ProfessionalLifecycleRecord[];
  staffLifecycle?: ProfessionalLifecycleRecord[];
}

type CareerStaffEvent =
  | 'career:staff:hire'
  | 'career:staff:fire'
  | 'career:staff:renew'
  | 'career:professional:lifecycle';

function sameId(left: unknown, right: unknown) {
  return String(left ?? '').trim().toLocaleUpperCase('pt-BR')
    === String(right ?? '').trim().toLocaleUpperCase('pt-BR');
}

function requestId() {
  return crypto.randomUUID();
}

function compactLifecyclePayload(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).flatMap(([key, value]) => {
    if (typeof value !== 'string') return [[key, value]];
    const trimmed = value.trim();
    return trimmed ? [[key, trimmed]] : [];
  }));
}

function mutation<T extends RoomMutation>(
  socket: BolaSocket,
  event: CareerStaffEvent | 'club:upgrade' | 'club:news-read',
  payload: Record<string, unknown>,
): Promise<T> {
  return emitSocketRequest<T>(socket, event, payload);
}

export function useClubCareer(room: Room | null, socket: BolaSocket | null, clubId: string, managerId: string) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationIds = useRef(new Map<string, string>());
  const state = room?.clubCareerState;
  const staffState = state as unknown as RuntimeStaffState | undefined;

  const facility = useMemo(() => state?.clubFacilities?.find((candidate) => sameId(candidate.clubId, clubId)) ?? null,
    [clubId, state?.clubFacilities]);
  const projects = useMemo(() => (state?.facilityProjects ?? []).filter((project) => sameId(project.clubId, clubId)),
    [clubId, state?.facilityProjects]);
  const activeProjects = useMemo(() => projects.filter((project) => project.status === 'active'), [projects]);
  const staff = useMemo(() => (staffState?.staffMembers ?? []).filter((member) => (
    sameId(member.clubId, clubId) && ['employed', 'on_leave'].includes(member.status)
  )), [clubId, staffState?.staffMembers]);
  const candidates = useMemo(() => (staffState?.staffCandidates ?? []).filter((member) => (
    !member.clubId && member.status === 'free_agent'
  )), [staffState?.staffCandidates]);
  const staffContracts = useMemo(() => (staffState?.staffContracts ?? []).filter((contract) => (
    sameId(contract.clubId, clubId)
  )), [clubId, staffState?.staffContracts]);
  const activeStaffContracts = useMemo(() => staffContracts.filter((contract) => contract.status === 'active'),
    [staffContracts]);
  const contractForStaff = useCallback((staffId: string) => activeStaffContracts.find((contract) => (
    sameId(contract.staffId, staffId)
  )) ?? null, [activeStaffContracts]);
  const staffEffects = useMemo(() => {
    const effects = staffState?.staffEffectsByClub;
    if (!effects || Array.isArray(effects)) return null;
    const key = Object.keys(effects).find((candidate) => sameId(candidate, clubId));
    return key ? effects[key] : null;
  }, [clubId, staffState?.staffEffectsByClub]);
  const professionalLifecycle = useMemo(() => {
    const entries = staffState?.professionalLifecycle
      ?? staffState?.professionalTransitions
      ?? staffState?.staffLifecycle
      ?? [];
    return entries.filter((entry) => (
      (!entry.professionalType || entry.professionalType === 'staff')
        && (!entry.clubId || sameId(entry.clubId, clubId))
    ));
  }, [
    clubId,
    staffState?.professionalLifecycle,
    staffState?.professionalTransitions,
    staffState?.staffLifecycle,
  ]);
  const lifecycleForStaff = useCallback((staffId: string) => professionalLifecycle.filter((entry) => (
    sameId(entry.professionalId, staffId)
  )), [professionalLifecycle]);
  const financeProfile = useMemo(() => state?.financeProfiles?.find((profile) => sameId(profile.clubId, clubId)) ?? null,
    [clubId, state?.financeProfiles]);
  const transactions = useMemo(() => (state?.financialTransactions ?? []).filter((entry) => sameId(entry.clubId, clubId)),
    [clubId, state?.financialTransactions]);
  const financialAggregates = useMemo(() => ({
    monthly: (state?.financialAggregates?.monthly ?? []).filter((entry) => sameId(entry.clubId, clubId)),
    yearly: (state?.financialAggregates?.yearly ?? []).filter((entry) => sameId(entry.clubId, clubId)),
    total: (state?.financialAggregates?.totals ?? []).find((entry) => sameId(entry.clubId, clubId)) ?? null,
  }), [clubId, state?.financialAggregates]);
  const news = useMemo(() => (state?.news ?? []).filter((item) => (
    item.clubIds.length === 0 || item.clubIds.some((candidate) => sameId(candidate, clubId))
  )), [clubId, state?.news]);
  const unreadNews = useMemo(() => news.filter((item) => !item.readByManagerIds.includes(managerId)), [managerId, news]);

  useEffect(() => {
    operationIds.current.clear();
    setPending(null);
    setError(null);
  }, [clubId, managerId, room?.code]);

  const run = useCallback(async <T,>(key: string, action: () => Promise<T>) => {
    if (!room || !socket?.connected) throw new Error('A conexao em tempo real ainda nao esta pronta.');
    setPending(key);
    setError(null);
    try {
      return await action();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Nao foi possivel concluir a operacao.';
      setError(message);
      throw new Error(message);
    } finally {
      setPending(null);
    }
  }, [room, socket]);

  const operationIdFor = useCallback((intent: string) => {
    const current = operationIds.current.get(intent);
    if (current) return current;
    const created = requestId();
    operationIds.current.set(intent, created);
    return created;
  }, []);

  const completeIntent = useCallback((intent: string) => {
    operationIds.current.delete(intent);
  }, []);

  const startUpgrade = useCallback((areaId: string, options: { noticeApproval?: boolean } = {}) => run(`upgrade:${areaId}`, async () => {
    if (!room || !socket) throw new Error('Save indisponivel.');
    const intent = `upgrade:${room.code}:${clubId}:${areaId}`;
    const operationId = operationIdFor(intent);
    const response = await mutation<{ room: Room; project: ClubFacilityProject }>(
      socket,
      'club:upgrade',
      { code: room.code, clubId, areaId, requestId: operationId, ...options },
    );
    completeIntent(intent);
    return response.project;
  }), [clubId, completeIntent, operationIdFor, room, run, socket]);

  const hireStaff = useCallback((staffId: string, options: { years?: number; wage?: number; signingBonus?: number } = {}) => (
    run(`hire:${staffId}`, async () => {
      if (!room || !socket) throw new Error('Save indisponivel.');
      const intent = `hire:${room.code}:${clubId}:${staffId}:${JSON.stringify(options)}`;
      const operationId = operationIdFor(intent);
      const response = await mutation<{ room: Room; member: CareerStaffMember; contract: CareerStaffContract }>(
        socket,
        'career:staff:hire',
        { code: room.code, clubId, staffId, requestId: operationId, ...options },
      );
      completeIntent(intent);
      return response.member;
    })
  ), [clubId, completeIntent, operationIdFor, room, run, socket]);

  const fireStaff = useCallback((staffId: string, options: { mutualAgreement?: boolean } = {}) => run(`fire:${staffId}`, async () => {
    if (!room || !socket) throw new Error('Save indisponivel.');
    const intent = `fire:${room.code}:${clubId}:${staffId}:${JSON.stringify(options)}`;
    const operationId = operationIdFor(intent);
    const response = await mutation<{ room: Room; member: CareerStaffMember; contract: CareerStaffContract }>(
      socket,
      'career:staff:fire',
      { code: room.code, clubId, staffId, requestId: operationId, ...options },
    );
    completeIntent(intent);
    return response.member;
  }), [clubId, completeIntent, operationIdFor, room, run, socket]);

  const renewStaff = useCallback((staffId: string, options: { years?: number; wage?: number; renewalBonus?: number } = {}) => (
    run(`renew:${staffId}`, async () => {
      if (!room || !socket) throw new Error('Save indisponivel.');
      const intent = `renew:${room.code}:${clubId}:${staffId}:${JSON.stringify(options)}`;
      const operationId = operationIdFor(intent);
      const response = await mutation<{ room: Room; member: CareerStaffMember; contract: CareerStaffContract }>(
        socket,
        'career:staff:renew',
        { code: room.code, clubId, staffId, requestId: operationId, ...options },
      );
      completeIntent(intent);
      return response.member;
    })
  ), [clubId, completeIntent, operationIdFor, room, run, socket]);

  const runStaffLifecycle = useCallback((
    staffId: string,
    action: ProfessionalLifecycleAction,
    payload: Record<string, unknown> = {},
  ) => run(`lifecycle:${staffId}:${action}`, async () => {
    if (!room || !socket) throw new Error('Save indisponivel.');
    const compactPayload = compactLifecyclePayload(payload);
    const intent = `lifecycle:${room.code}:${clubId}:${staffId}:${action}:${JSON.stringify(compactPayload)}`;
    const operationId = operationIdFor(intent);
    const response = await mutation<{
      room: Room;
      member?: CareerStaffMember;
      lifecycle?: ProfessionalLifecycleRecord;
    }>(
      socket,
      'career:professional:lifecycle',
      {
        ...compactPayload,
        code: room.code,
        clubId,
        professionalType: 'staff',
        professionalId: staffId,
        requestId: operationId,
        action,
      },
    );
    completeIntent(intent);
    return response.lifecycle ?? response.member ?? response.room;
  }), [clubId, completeIntent, operationIdFor, room, run, socket]);

  const hireStaffPackage = useCallback((
    members: CareerStaffPackageMemberInput[],
    maximumFirstYearCost?: number,
  ) => run('staff-package-hire', async () => {
    if (!room || !socket) throw new Error('Save indisponivel.');
    if (!members.length) throw new Error('Selecione ao menos um profissional.');
    const payload = {
      members,
      ...(maximumFirstYearCost !== undefined && maximumFirstYearCost > 0
        ? { maximumFirstYearCost }
        : {}),
    };
    const intent = `staff-package:${room.code}:${clubId}:${managerId}:${JSON.stringify(payload)}`;
    const operationId = operationIdFor(intent);
    const response = await mutation<{ room: Room; lifecycle?: ProfessionalLifecycleRecord }>(
      socket,
      'career:professional:lifecycle',
      {
        ...payload,
        code: room.code,
        clubId,
        professionalType: 'coach',
        professionalId: managerId,
        coachId: managerId,
        requestId: operationId,
        action: 'staff_package_hire',
      },
    );
    completeIntent(intent);
    return response.room;
  }), [clubId, completeIntent, managerId, operationIdFor, room, run, socket]);

  const markNewsRead = useCallback((newsIds: string[]) => run('news-read', async () => {
    if (!room || !socket || newsIds.length === 0) return 0;
    const response = await mutation<{ room: Room; readCount: number }>(
      socket,
      'club:news-read',
      { code: room.code, newsIds },
    );
    return response.readCount;
  }), [room, run, socket]);

  return {
    state,
    facility,
    projects,
    activeProjects,
    financeProfile,
    transactions,
    financialAggregates,
    staff,
    candidates,
    staffContracts,
    activeStaffContracts,
    contractForStaff,
    staffEffects,
    professionalLifecycle,
    lifecycleForStaff,
    news,
    unreadNews,
    pending,
    error,
    startUpgrade,
    hireStaff,
    fireStaff,
    renewStaff,
    runStaffLifecycle,
    hireStaffPackage,
    markNewsRead,
  };
}
