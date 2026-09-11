import { channelForRoom } from "../sockets/helpers.mjs";
import { buildCentralSnapshot } from "../game/centralSelectors.mjs";
import { facilityView } from "../game/clubFacilities.mjs";
import { withTimeout } from "../infrastructure/readiness.mjs";

function clubKey(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().toLocaleLowerCase("pt-BR")
    : "";
}

function viewerClubAliases(room, clubId) {
  const requested = clubKey(clubId);
  const aliases = new Set(requested ? [requested] : []);
  if (!requested) return aliases;
  const clubs = [
    ...(Array.isArray(room?.competitionCatalog) ? room.competitionCatalog : [])
      .flatMap((competition) => Array.isArray(competition?.clubs) ? competition.clubs : []),
    ...(Array.isArray(room?.tournamentCatalog) ? room.tournamentCatalog : [])
      .flatMap((competition) => Array.isArray(competition?.participants) ? competition.participants : []),
  ];
  const club = clubs.find((candidate) => (
    [candidate?.id, candidate?.code, candidate?.name].some((value) => clubKey(value) === requested)
  ));
  for (const value of [club?.id, club?.code, club?.name]) {
    const normalized = clubKey(value);
    if (normalized) aliases.add(normalized);
  }
  return aliases;
}

function publicFacility(facility) {
  if (!facility || typeof facility !== "object") return null;
  const stadium = facility.stadium && typeof facility.stadium === "object"
    ? facility.stadium
    : {};
  return {
    clubId: facility.clubId,
    stadium: {
      name: stadium.name,
      capacity: stadium.capacity,
    },
  };
}

function publicStaffCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || clubKey(candidate.clubId)) return null;
  const {
    professionalHistory: _professionalHistory,
    contract: _contract,
    contractId: _contractId,
    ...publicCandidate
  } = candidate;
  return {
    ...publicCandidate,
    clubId: null,
    contractId: null,
    professionalHistory: [],
  };
}

function historyBelongsToViewer(entry, owns) {
  if (!entry || typeof entry !== "object") return false;
  return [
    entry.clubId,
    entry.relatedClubId,
    entry.fromClubId,
    entry.toClubId,
    entry.metadata?.clubId,
    entry.metadata?.relatedClubId,
  ].some(owns);
}

function newsForViewer(news, viewerId) {
  if (!news || typeof news !== "object") return news;
  const wasRead = Boolean(viewerId) && Array.isArray(news.readByManagerIds)
    && news.readByManagerIds.includes(viewerId);
  const readAt = viewerId && news.readAtByManagerId && typeof news.readAtByManagerId === "object"
    ? news.readAtByManagerId[viewerId]
    : undefined;
  return {
    ...news,
    readByManagerIds: wasRead ? [viewerId] : [],
    readAtByManagerId: readAt ? { [viewerId]: readAt } : {},
  };
}

const PRIVATE_COACH_CAREER_FIELDS = Object.freeze([
  "salary",
  "wage",
  "expectedSalary",
  "contract",
  "contractId",
  "releaseClause",
  "terminationClause",
  "bonuses",
  "guarantees",
  "objectives",
  "proposal",
  "proposals",
  "interview",
  "interviews",
  "privateClause",
]);

function publicCoachCareerRecord(value) {
  if (!value || typeof value !== "object") return value;
  const result = structuredClone(value);
  for (const field of PRIVATE_COACH_CAREER_FIELDS) delete result[field];
  if (Array.isArray(result.assignments)) {
    result.assignments = result.assignments.map((assignment) => {
      if (!assignment || typeof assignment !== "object") return assignment;
      const publicAssignment = structuredClone(assignment);
      for (const field of PRIVATE_COACH_CAREER_FIELDS) delete publicAssignment[field];
      return publicAssignment;
    });
  }
  return result;
}

function coachCareerStateForViewer(state) {
  if (!state || typeof state !== "object") return state;
  return {
    ...state,
    coaches: (Array.isArray(state.coaches) ? state.coaches : []).map(publicCoachCareerRecord),
  };
}

function professionalLifecycleProjection(state) {
  if (!state || typeof state !== "object") return [];
  const publicStatus = (status, kind) => {
    if (["completed", "cancelled", "rejected", "proposed", "countered", "accepted", "signed", "active"].includes(status)) {
      return status;
    }
    if (["ended_early", "effective", "executed"].includes(status)) return "completed";
    if (status === "expired") return "cancelled";
    if (status === "scheduled") return "active";
    if (status === "awaiting_signatures") return "accepted";
    return kind === "retirement" ? "active" : "proposed";
  };
  const collect = (values, kind) => (Array.isArray(values) ? values : []).map((entry) => {
    const compensation = typeof entry?.compensation === "object"
      ? entry.compensation?.compensation ?? entry.compensation?.total ?? null
      : entry?.terms?.compensation ?? entry?.compensation ?? null;
    const effectiveAt = kind === "notice"
      ? entry?.expectedEndDate
      : kind === "mutual_agreement" ? entry?.departureDate : entry?.effectiveAt;
    return {
      ...entry,
      professionalType: entry?.professionalType ?? (entry?.staffId ? "staff" : "coach"),
      professionalId: entry?.professionalId ?? entry?.staffId ?? entry?.coachId ?? "",
      status: publicStatus(entry?.status, kind),
      createdAt: entry?.createdAt ?? entry?.communicatedAt ?? entry?.announcedAt ?? entry?.proposedAt ?? null,
      effectiveAt: effectiveAt ?? null,
      completedAt: entry?.endedAt ?? entry?.executedAt ?? entry?.cancelledAt ?? entry?.rejectedAt ?? null,
      compensation,
      startsAt: entry?.startDate ?? entry?.communicatedAt ?? null,
      endsAt: kind === "notice" ? entry?.expectedEndDate ?? null : effectiveAt ?? null,
      retirementAt: kind === "retirement" ? entry?.effectiveAt ?? null : undefined,
      retirementType: kind === "retirement" ? entry?.kind ?? "scheduled" : undefined,
      proposedExitAt: kind === "mutual_agreement" ? entry?.departureDate ?? null : undefined,
      confidentiality: kind === "mutual_agreement" ? Boolean(entry?.terms?.confidentiality) : undefined,
      benefitsUntil: kind === "mutual_agreement" ? entry?.terms?.benefitsThrough ?? null : undefined,
      metadata: {
        ...(entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {}),
        kind,
        ...(kind === "mutual_agreement" ? {
          negotiationRound: entry?.negotiationRound ?? 1,
          nextResponder: entry?.nextResponder ?? null,
          internalStatus: entry?.status ?? null,
          signatures: entry?.signatures && typeof entry.signatures === "object"
            ? structuredClone(entry.signatures)
            : {},
        } : {}),
      },
    };
  });
  return [
    ...collect(state.notices, "notice"),
    ...collect(state.retirements, "retirement"),
    ...collect(state.mutualAgreements, "mutual_agreement"),
  ];
}

function professionalLeaveProjection(state) {
  if (!state || typeof state !== "object") return [];
  return (Array.isArray(state.leaves) ? state.leaves : []).map((entry) => ({
    id: entry?.id ?? "",
    kind: "leave",
    professionalType: entry?.professionalType ?? (entry?.staffId ? "staff" : "coach"),
    professionalId: entry?.professionalId ?? entry?.staffId ?? entry?.coachId ?? "",
    clubId: entry?.clubId ?? null,
    status: entry?.status === "scheduled"
      ? "active"
      : entry?.status === "ended_early" ? "completed" : entry?.status ?? "active",
    initiatedBy: entry?.initiatedBy ?? "system",
    reason: entry?.endReason ?? entry?.reason ?? null,
    createdAt: entry?.requestedAt ?? null,
    updatedAt: entry?.endedAt ?? entry?.cancelledAt ?? entry?.activatedAt ?? entry?.requestedAt ?? null,
    effectiveAt: entry?.expectedEndAt ?? null,
    completedAt: entry?.endedAt ?? entry?.cancelledAt ?? null,
    compensation: null,
    startsAt: entry?.startsAt ?? null,
    endsAt: entry?.endedAt ?? entry?.cancelledAt ?? entry?.expectedEndAt ?? null,
    expectedEndAt: entry?.expectedEndAt ?? null,
    leaveStatus: entry?.status ?? "scheduled",
    actingStaffId: entry?.actingStaffId ?? null,
    contractRemainsActive: entry?.contractRemainsActive !== false,
    payment: entry?.payment && typeof entry.payment === "object"
      ? structuredClone(entry.payment)
      : null,
    metadata: {
      internalStatus: entry?.status ?? null,
      contractId: entry?.contractId ?? null,
      interimAssignmentId: entry?.interimAssignmentId ?? null,
      ...(entry?.metadata && typeof entry.metadata === "object"
        ? structuredClone(entry.metadata)
        : {}),
    },
  }));
}

/**
 * clubCareerState is an authoritative server aggregate, not a public DTO.
 * Keep a strict allow-list here so newly added internal fields do not become
 * visible to every manager by default.
 */
function careerStateForViewer(careerState, aliases, viewerId) {
  if (!careerState || typeof careerState !== "object") return careerState;
  const owns = (value) => aliases.has(clubKey(value));
  const ownEntries = (entries) => (Array.isArray(entries)
    ? entries.filter((entry) => owns(entry?.clubId))
    : []);
  const keyedForViewer = (value) => (
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([clubId]) => owns(clubId)))
      : {}
  );

  return {
    version: careerState.version,
    currentDate: careerState.currentDate,
    financialTransactions: ownEntries(careerState.financialTransactions),
    financialAggregates: careerState.financialAggregates && typeof careerState.financialAggregates === "object"
      ? {
        version: careerState.financialAggregates.version,
        monthly: ownEntries(careerState.financialAggregates.monthly),
        yearly: ownEntries(careerState.financialAggregates.yearly),
        totals: ownEntries(careerState.financialAggregates.totals),
      }
      : undefined,
    financeProfiles: ownEntries(careerState.financeProfiles),
    lastFinancialPeriodByClub: keyedForViewer(careerState.lastFinancialPeriodByClub),
    financialAlerts: ownEntries(careerState.financialAlerts),
    clubFacilities: (Array.isArray(careerState.clubFacilities) ? careerState.clubFacilities : [])
      .flatMap((facility) => {
        if (owns(facility?.clubId)) return [facilityView(facility)];
        const publicSnapshot = publicFacility(facility);
        return publicSnapshot ? [publicSnapshot] : [];
      }),
    facilityProjects: ownEntries(careerState.facilityProjects),
    staffSchemaVersion: careerState.staffSchemaVersion,
    staffMembers: ownEntries(careerState.staffMembers),
    staffCandidates: (Array.isArray(careerState.staffCandidates) ? careerState.staffCandidates : [])
      .map(publicStaffCandidate)
      .filter(Boolean),
    staffContracts: ownEntries(careerState.staffContracts),
    staffHistory: (Array.isArray(careerState.staffHistory) ? careerState.staffHistory : [])
      .filter((entry) => historyBelongsToViewer(entry, owns)),
    professionalLifecycle: ownEntries(careerState.professionalLifecycle),
    staffEffectsByClub: keyedForViewer(careerState.staffEffectsByClub),
    staffInitializedClubIds: [],
    processedStaffOperationIds: [],
    events: [],
    news: (Array.isArray(careerState.news) ? careerState.news : [])
      .map((news) => newsForViewer(news, viewerId)),
    processedEventIds: [],
  };
}

function deleteLegacyPrivateState(room) {
  for (const field of [
    "financialTransactions",
    "financialAggregates",
    "financeProfiles",
    "financialAlerts",
    "lastFinancialPeriodByClub",
    "staff",
    "staffMembers",
    "staffCandidates",
    "staffContracts",
    "staffHistory",
    "staffEffectsByClub",
    "processedStaffOperationIds",
  ]) {
    delete room[field];
  }
}

export function roomForViewer(room, viewerId) {
  if (!room) return room;
  const viewer = (Array.isArray(room.managers) ? room.managers : [])
    .find((manager) => manager?.id === viewerId);
  const viewerClubId = viewer?.clubId ?? "";
  const centralSnapshot = buildCentralSnapshot(room, {
    clubId: viewerClubId,
    managerId: viewerId,
  });
  const completedFixtureCount = Array.isArray(room.completedFixtureIds)
    ? room.completedFixtureIds.length
    : Number(room.completedFixtureCount ?? 0);
  const completedMatchCount = Array.isArray(room.completedMatches)
    ? room.completedMatches.length
    : Number(room.completedMatchCount ?? 0);
  const seasonHistoryCount = Array.isArray(room.seasonHistory)
    ? room.seasonHistory.length
    : Number(room.seasonHistoryCount ?? 0);
  // Never clone or broadcast unbounded/private branches. Full mutations still
  // return a Room internally, but viewers receive only the lightweight shape.
  const {
    playerStates: _playerStates,
    careerState: _careerState,
    marketState: _marketState,
    coachEmploymentState: _coachEmploymentState,
    professionalLifecycleState,
    professionalLeaveState,
    activeMatch: _activeMatch,
    completedMatches: _completedMatches,
    matchHistoryPending: _matchHistoryPending,
    matchHistoryVersion: _matchHistoryVersion,
    scoutingState: _scoutingState,
    tacticalStudyState: _tacticalStudyState,
    seasonHistory: _seasonHistory,
    ...viewerRoom
  } = room;
  const visible = structuredClone(viewerRoom);
  visible.completedFixtureCount = completedFixtureCount;
  visible.completedMatchCount = completedMatchCount;
  visible.seasonHistoryCount = seasonHistoryCount;
  visible.centralSnapshot = centralSnapshot;
  visible.coachCareerState = coachCareerStateForViewer(visible.coachCareerState);
  if (visible.clubCareerState) {
    visible.clubCareerState.professionalLifecycle = [
      ...professionalLifecycleProjection(professionalLifecycleState),
      ...professionalLeaveProjection(professionalLeaveState),
    ];
  }
  visible.clubCareerState = careerStateForViewer(
    visible.clubCareerState,
    viewerClubAliases(room, viewerClubId),
    viewerId,
  );
  deleteLegacyPrivateState(visible);
  const lineups = Array.isArray(visible.lineups) ? visible.lineups : [];
  visible.tacticPreviews = lineups.flatMap((lineup) => {
    const tactics = lineup?.tactics;
    if (lineup.managerId === viewerId || !tactics || tactics.secret !== false) return [];
    return [{
      managerId: lineup.managerId,
      clubId: lineup.clubId,
      formationId: tactics.formationId,
      mentality: tactics.mentality,
      teamInstructions: structuredClone(tactics.teamInstructions),
      updatedAt: lineup.updatedAt,
    }];
  });
  visible.lineups = lineups.filter((lineup) => lineup.managerId === viewerId);
  // Proposals, interviews, salaries and candidate shortlists are private.
  // They are exposed only through the manager-scoped coach-career endpoint.
  return visible;
}

export async function emitRoomForViewers(io, room, eventName = "room:state", {
  timeoutMs = 5_000,
  excludeSocketId = null,
} = {}) {
  const sockets = await withTimeout(
    io.in(channelForRoom(room.code)).fetchSockets(),
    timeoutMs,
    "socket-room-discovery",
  );
  const snapshots = new Map();
  for (const target of sockets) {
    if (excludeSocketId && target.id === excludeSocketId) continue;
    await new Promise((resolve) => setImmediate(resolve));
    const viewerId = target.data.user?.uid;
    const cacheKey = viewerId || target.id;
    if (!snapshots.has(cacheKey)) snapshots.set(cacheKey, roomForViewer(room, viewerId));
    target.emit(eventName, snapshots.get(cacheKey));
  }
}
