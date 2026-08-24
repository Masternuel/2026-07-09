import type { Socket } from 'socket.io-client';

export type AppStage = 'entry' | 'lobby' | 'editor' | 'game';

export type EditorEntity = 'leagues' | 'clubs' | 'players' | 'tournaments';

export type TournamentFormat = 'league' | 'knockout' | 'groups_knockout';
export type TournamentLegs = 'single' | 'double';
export type TournamentTiebreaker =
  | 'goal_difference'
  | 'goals_scored'
  | 'wins'
  | 'head_to_head'
  | 'fair_play'
  | 'away_goals'
  | 'extra_time'
  | 'penalties'
  | 'drawing_lots';

export interface EditorLeague {
  id: string;
  name: string;
  country: string;
  level: number;
  division: string;
  legs: TournamentLegs;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorClub {
  id: string;
  name: string;
  abbreviation: string;
  colors: string[];
  darkThemeColor: string | null;
  lightThemeColor: string | null;
  stadium: string;
  stadiumCapacity: number;
  reputation: number;
  division: string;
  country: string;
  state: string | null;
  city: string | null;
  leagueId: string | null;
  budget: number;
  crestImageUrl: string | null;
  crestImagePath: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorPlayerAttributes {
  velocidade: number;
  chute: number;
  drible: number;
  nocao: number;
  defesa: number;
  passe: number;
  peBom: number;
  peRuim: number;
  forca: number;
  resistencia: number;
  impulsao: number;
  reflexos: number;
  posicionamentoGol: number;
  saidaGol: number;
  penaltis: number;
}

export interface EditorPlayer {
  id: string;
  clubId: string;
  name: string;
  isStar: boolean;
  position: PlayerPosition;
  age: number;
  nationality: string;
  shirtNumber: number;
  overall: number;
  attributes: EditorPlayerAttributes;
  avatarImageUrl: string | null;
  avatarImagePath: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorTournament {
  id: string;
  name: string;
  format: TournamentFormat;
  teamCount: number;
  legs: TournamentLegs;
  tiebreakers: TournamentTiebreaker[];
  teamIds: string[];
  trophyImageUrl: string | null;
  trophyImagePath: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type EditorRecord = EditorLeague | EditorClub | EditorPlayer | EditorTournament;

export interface EditorCatalog {
  leagues: EditorLeague[];
  clubs: EditorClub[];
  players: EditorPlayer[];
  tournaments: EditorTournament[];
}

export interface EditorCatalogCounts {
  leagues: number;
  clubs: number;
  players: number;
  tournaments: number;
}

export type RouteKey =
  | 'home'
  | 'coach-career'
  | 'squad'
  | 'tactics'
  | 'calendar'
  | 'competitions'
  | 'market'
  | 'finance'
  | 'stadium'
  | 'rankings'
  | 'news'
  | 'staff'
  | 'reports'
  | 'match'
  | 'press-conference'
  | 'settings';

export type PlayerPosition = 'GOL' | 'ZAG' | 'LD' | 'LE' | 'VOL' | 'MC' | 'MEI' | 'PD' | 'PE' | 'ATA';
export type PlayerStatus = 'Disponível' | 'Lesionado' | 'Suspenso' | 'Cansado';
export type Morale = 'Excelente' | 'Boa' | 'Neutra' | 'Baixa' | 'Não informada';

export type PlayerCatalogUnknownField =
  | 'shirtNumber'
  | 'condition'
  | 'attributes'
  | 'foot'
  | 'morale'
  | 'contract'
  | 'potential'
  | 'worldStar';

export type AttributeKey = keyof EditorPlayerAttributes;

export interface PlayerCareerStats {
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  injuries: number;
  /** Sum of deterministic 1–10 match ratings. Optional for legacy saves. */
  ratingTotal?: number;
  /** Matches included in ratingTotal. Optional for legacy saves. */
  ratedMatches?: number;
}

export interface PlayerSeasonStats extends PlayerCareerStats {
  seasonNumber: number;
}

export interface PlayerCompetitionStats extends PlayerCareerStats {
  competitionId: string;
  seasonNumber: number;
  shots: number | null;
  shotsOnTarget: number | null;
  saves: number | null;
  goalsConceded: number | null;
  cleanSheets: number | null;
  lastMatchId?: string | null;
}

export type CareerTrainingFocus = 'balanced' | 'technical' | 'attacking' | 'defending' | 'physical' | 'goalkeeping' | 'recovery';
export type CareerTrainingIntensity = 'low' | 'normal' | 'high';
export type CareerContractStatus = 'active' | 'academy' | 'expired' | 'free_agent' | 'retired' | 'released';
export type CareerStage = 'academy' | 'senior' | 'retired';

export interface CareerContract {
  id?: string | null;
  clubId: string | null;
  startSeason: number | null;
  endSeason: number | null;
  startDate?: string | null;
  endDate?: string | null;
  wage: number;
  status: CareerContractStatus;
  renewalCount: number;
  transferId?: string | null;
}

export interface CareerContractHistoryEntry extends CareerContract {
  endedAt?: string | null;
  reason?: string | null;
}

export interface CareerTransferHistoryEntry {
  id: string;
  dealType: 'transfer' | 'loan' | 'loan_return' | 'free_agent';
  fromClubId: string | null;
  toClubId: string | null;
  amount: number;
  completedAt: string;
  effectiveSeason?: number | null;
}

export interface CareerCompetitionRegistration {
  competitionId: string;
  clubId: string;
  status: 'active' | 'removed';
  registeredAt?: string | null;
  removedAt?: string | null;
}

export interface CareerTrainingPlan {
  playerId: string;
  focus: CareerTrainingFocus;
  intensity: CareerTrainingIntensity;
  active: boolean;
}

export interface CareerPlayerSnapshot {
  id: string;
  clubId: string | null;
  currentClubId?: string | null;
  ownerClubId?: string | null;
  name: string;
  position: PlayerPosition;
  age: number;
  nationality: string;
  overall: number;
  potential: number;
  academy: boolean;
  youth: boolean;
  retired: boolean;
  careerStage: CareerStage;
  active: boolean;
  condition?: number;
  wage?: number;
  contract: CareerContract;
  contractHistory?: CareerContractHistoryEntry[];
  transferHistory?: CareerTransferHistoryEntry[];
  competitionRegistrations?: CareerCompetitionRegistration[];
  training?: CareerTrainingPlan;
  generatedSeason?: number;
  promotedSeason?: number;
  nationalTeamId?: string | null;
  internationalCaps?: number;
}

export interface CareerNationalSquad {
  teamId: string;
  seasonNumber: number;
  squadSize: number;
  playerIds: string[];
  eligibleCount: number;
}

export interface CareerSnapshot {
  currentSeason: number;
  players: CareerPlayerSnapshot[];
  trainingPlans: CareerTrainingPlan[];
  nationalSquads: CareerNationalSquad[];
  lastSummary: unknown | null;
}

export type CoachEmploymentStatus =
  | 'employed'
  | 'unemployed'
  | 'negotiating'
  | 'notice'
  | 'on_leave'
  | 'dismissed'
  | 'resigned'
  | 'interim'
  | 'awaiting_start'
  | 'retiring'
  | 'retired';

export type CoachContractStatus = 'active' | 'scheduled' | 'expired' | 'terminated' | 'superseded' | 'cancelled';
export type ProfessionalLifecycleAction =
  | 'notice_start'
  | 'notice_end_early'
  | 'retirement_announce'
  | 'retirement_postpone'
  | 'retirement_cancel'
  | 'mutual_agreement_propose'
  | 'mutual_agreement_counter'
  | 'mutual_agreement_accept'
  | 'mutual_agreement_reject'
  | 'mutual_agreement_sign'
  | 'preferred_staff_update'
  | 'staff_link_update'
  | 'staff_package_hire'
  | 'interim_confirm'
  | 'leave_start'
  | 'leave_end'
  | 'leave_cancel';
export type ProfessionalLifecycleStatus =
  | 'draft'
  | 'proposed'
  | 'countered'
  | 'accepted'
  | 'signed'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'postponed';
export type ProfessionalAffiliationType =
  | 'independent'
  | 'personal_team'
  | 'personal_staff'
  | 'coach_recommended'
  | 'inherited';
export type ProfessionalNoticeType = 'standard' | 'worked' | 'negotiated' | 'immediate';
export type ProfessionalRetirementType =
  | 'immediate'
  | 'end_season'
  | 'end_contract'
  | 'scheduled'
  | 'planned'
  | 'end_of_season'
  | 'end_of_contract';

export interface ProfessionalLifecycleTerms {
  confidentiality?: boolean;
  preserveBonuses?: boolean;
  pendingBonuses?: number;
  temporaryBenefits?: number;
  noticePay?: number;
  benefitsUntil?: string | null;
  marketRelease?: boolean;
  waiverRate?: number;
  notes?: string;
}

export interface ProfessionalLifecycleRecord {
  id: string;
  kind?: string;
  professionalType: 'coach' | 'staff';
  professionalId: string;
  clubId: string | null;
  status: ProfessionalLifecycleStatus;
  initiatedBy: 'coach' | 'club' | 'mutual' | 'system' | string;
  reason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  effectiveAt: string | null;
  completedAt: string | null;
  compensation: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  retirementAt?: string | null;
  negotiationRound?: number | null;
  metadata: Record<string, unknown>;
}

export interface CoachNoticePeriod extends ProfessionalLifecycleRecord {
  kind: 'notice';
  startsAt: string | null;
  endsAt: string | null;
  durationDays: number | null;
  earlyExitAllowed: boolean;
  noticeType?: ProfessionalNoticeType | string;
  immediateExit?: boolean;
}

export interface CoachRetirementPlan extends ProfessionalLifecycleRecord {
  kind: 'retirement';
  announcedAt: string | null;
  retirementAt: string | null;
  retirementType: ProfessionalRetirementType | string;
  canCancel: boolean;
  canPostpone: boolean;
}

export interface CoachMutualAgreement extends ProfessionalLifecycleRecord {
  kind: 'mutual_agreement';
  negotiationRound: number;
  proposedBy: 'coach' | 'club' | string;
  proposedExitAt: string | null;
  confidentiality: boolean;
  benefitsUntil: string | null;
  terms: ProfessionalLifecycleTerms & Record<string, unknown>;
}

export interface ProfessionalLeavePayment {
  type: 'full' | 'partial' | 'unpaid';
  rate: number;
  monthlyWage: number;
  estimatedGross: number;
  actualGross: number | null;
  paidByClub: boolean;
  notes: string | null;
}

export interface CoachProfessionalLeave extends ProfessionalLifecycleRecord {
  kind: 'leave';
  startsAt: string | null;
  endsAt: string | null;
  expectedEndAt: string | null;
  leaveStatus: 'scheduled' | 'active' | 'completed' | 'ended_early' | 'cancelled' | string;
  actingStaffId: string | null;
  contractRemainsActive: boolean;
  payment: ProfessionalLeavePayment | null;
}

export interface CoachCareerTransition extends ProfessionalLifecycleRecord {
  kind: string;
  title: string;
  description: string | null;
}

export interface CoachPreferredStaffMember {
  staffId: string;
  name: string;
  role: string;
  roleLabel: string | null;
  affinity: number | null;
  availability: string | null;
  estimatedCost: number | null;
  affiliationType: ProfessionalAffiliationType;
  linkedCoachId: string | null;
}

export interface CoachLifecycleSnapshot {
  notices: CoachNoticePeriod[];
  retirements: CoachRetirementPlan[];
  mutualAgreements: CoachMutualAgreement[];
  leaves: CoachProfessionalLeave[];
  transitions: CoachCareerTransition[];
  preferredStaff: CoachPreferredStaffMember[];
}
export type CoachProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'countered'
  | 'expired'
  | 'withdrawn'
  | 'aguardando_resposta_diretoria'
  | 'aprovada_diretoria'
  | 'informacoes_solicitadas'
  | 'encerrado_vaga_preenchida';
export type CoachVacancyStatus = 'open' | 'shortlisting' | 'interviewing' | 'filled' | 'expired' | 'cancelled';
export type CoachProposalKind = 'hiring' | 'renewal' | 'precontract';
export type CoachMarketStage = 'interest' | 'interview' | 'coach_review' | 'club_review' | 'agreement' | 'completed' | 'closed';
export type CoachApplicationStatus = 'submitted' | 'shortlisted' | 'interview' | 'interview_completed' | 'offered' | 'accepted' | 'rejected' | 'withdrawn' | 'contratado' | 'encerrado_vaga_preenchida';
export type CoachInterviewStatus = 'pending' | 'scheduled' | 'awaiting_answers' | 'completed' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'contratado' | 'encerrado_vaga_preenchida';
export type CoachInterviewMode = 'legacy' | 'generative' | 'fallback';
export type CoachInterviewDepth = 'quick' | 'standard' | 'deep';
export type CoachInterviewSource = 'gemini' | 'fallback' | 'legacy' | null;
export type CoachProposalDecision = 'accept' | 'reject' | 'counter';
export type CoachJobSecurityLevel =
  | 'untouchable'
  | 'very_safe'
  | 'safe'
  | 'stable'
  | 'under_observation'
  | 'pressured'
  | 'very_pressured'
  | 'at_risk'
  | 'imminent';

export interface CoachClubReference {
  id: string;
  name: string;
  code: string;
  country: string | null;
  competition: string | null;
  reputation: number | null;
  crestImageUrl: string | null;
  primaryColor: string | null;
}

export interface CoachProfile {
  id: string;
  name: string;
  nationality: string | null;
  avatarImageUrl: string | null;
  license: string | null;
  preferredFormation: string | null;
  style: string | null;
  reputation: number;
  marketReputation: number;
  expectedSalary: number | null;
  winRate: number | null;
  titles: number;
  status: CoachEmploymentStatus;
  currentClubId: string | null;
  interestedClubs: CoachClubReference[];
}

export interface CoachBoardObjective {
  id: string;
  label: string;
  description: string | null;
  competition: string | null;
  target: string | null;
  progress: number | null;
  status: 'pending' | 'on_track' | 'completed' | 'failed';
  weight: number | null;
  difficultyAdjustment: number | null;
}

export interface CoachContractTerms {
  salary: number | null;
  durationMonths: number | null;
  startDate: string | null;
  endDate: string | null;
  releaseClause: number | null;
  transferBudget: number | null;
  autonomyLevel: number | null;
  objectiveDifficultyAdjustment: number | null;
  bonuses: string[];
  guarantees: string[];
  sportingTargets: string[];
  specialClauses: string[];
}

export interface CoachContract extends CoachContractTerms {
  id: string;
  coachId: string;
  clubId: string;
  club: CoachClubReference | null;
  role: string;
  status: CoachContractStatus;
  objectives: CoachBoardObjective[];
  renewalOption: boolean;
  sourceInterviewId: string | null;
  terminationReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CoachResignationConsequences {
  financialCost: number | null;
  reputationDelta: number | null;
  trustDelta: number | null;
  likelyUnemployedDays: number | null;
  inactivityDays: number | null;
  restrictionEndsAt: string | null;
  reasonCode: string;
  reasonLabel: string;
  justCauseVerified: boolean;
  pendingProjectPenalty: boolean;
  boardReaction: string | null;
  pendingObjectives: string[];
  reasonOptions: CoachResignationReasonOption[];
}

export interface CoachResignationReasonOption {
  code: string;
  label: string;
  justCause: boolean;
  justCauseVerified: boolean;
  financialCost: number | null;
  reputationDelta: number | null;
  trustDelta: number | null;
  likelyUnemployedDays: number | null;
  inactivityDays: number | null;
  restrictionEndsAt: string | null;
  pendingProjectPenalty: boolean;
  boardReaction: string | null;
  pendingObjectives: string[];
}

export interface CoachMarketRestriction {
  active: boolean;
  type: 'voluntary_resignation';
  startsAt: string | null;
  endsAt: string | null;
  remainingDays: number;
  canInterview: boolean;
  canSign: boolean;
  reasonCode: string;
  reasonLabel: string;
  justCauseVerified: boolean;
  offersReceived: number;
}

export interface CoachCareerTrust {
  score: number;
  voluntaryExitCount: number;
  completedContractCount: number;
  label: string;
}

export interface CoachCareerConductEntry {
  id: string;
  type: string;
  occurredAt: string | null;
  club: CoachClubReference | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  reputationDelta: number;
  reputationBefore: number | null;
  reputationAfter: number | null;
  trustDelta: number;
  restrictionEndsAt: string | null;
}

export interface CoachEmployment {
  id: string;
  coachId: string;
  clubId: string;
  club: CoachClubReference;
  role: string;
  status: CoachEmploymentStatus;
  hiredAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  entryReason: string | null;
  exitReason: string | null;
  contractId: string | null;
  contract: CoachContract | null;
  objectives: CoachBoardObjective[];
  resignationConsequences: CoachResignationConsequences | null;
}

export interface CoachJobSecurityFactor {
  id: string;
  label: string;
  detail: string | null;
  impact: number;
  tone: 'positive' | 'negative' | 'neutral';
}

export type CoachJobSecurityTrendDirection = 'rising' | 'stable' | 'falling';

export interface CoachJobSecurityTrend {
  direction: CoachJobSecurityTrendDirection;
  delta: number;
  label: string;
}

export interface CoachJobSecurityFanSupport {
  value: number;
  state: string;
  label: string;
  trend: CoachJobSecurityTrendDirection;
}

export interface CoachJobSecurityPrivateEstimate {
  min: number;
  max: number;
  label: string;
  source: string;
}

export interface CoachJobSecurityBoardSupport {
  publicValue: number;
  publicState: string;
  publicLabel: string;
  privateEstimate: CoachJobSecurityPrivateEstimate | null;
}

export interface CoachJobSecurityClassics {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winlessStreak: number;
  heavyLosses: number;
  eliminations: number;
  impact: number;
}

export interface CoachJobSecurityRelegation {
  risk: number;
  state: string;
  label: string;
  inZone: boolean;
  consecutiveRounds: number;
  confirmed: boolean;
  survivalSecured: boolean;
}

export interface CoachJobSecurityAccumulatedCredit {
  value: number;
  label: string;
  delta: number;
}

export interface CoachJobSecurityDimension {
  id: string;
  label: string;
  value: number;
  weight: number;
  trend: CoachJobSecurityTrendDirection;
  justification: string | null;
  updatedAt: string | null;
}

export interface CoachJobSecurityUltimatum {
  id: string;
  status: string;
  title: string;
  objective: string;
  deadlineRound: number | null;
  progress: number;
  consequence: string;
}

export interface CoachJobSecurityHistoryEntry {
  id: string;
  occurredAt: string | null;
  previousLevel: CoachJobSecurityLevel | null;
  newLevel: CoachJobSecurityLevel;
  previousScore: number | null;
  newScore: number;
  decision: string;
}

export interface CoachJobSecurity {
  score: number;
  level: CoachJobSecurityLevel;
  label: string;
  updatedAt: string | null;
  factors: CoachJobSecurityFactor[];
  trend: CoachJobSecurityTrend | null;
  fanSupport: CoachJobSecurityFanSupport | null;
  boardSupport: CoachJobSecurityBoardSupport | null;
  classics: CoachJobSecurityClassics | null;
  relegation: CoachJobSecurityRelegation | null;
  accumulatedCredit: CoachJobSecurityAccumulatedCredit | null;
  dimensions: CoachJobSecurityDimension[];
  activeUltimatums: CoachJobSecurityUltimatum[];
  recentHistory: CoachJobSecurityHistoryEntry[];
}

export type CoachGuaranteeStatus =
  | 'requested'
  | 'pending_formalization'
  | 'formalized'
  | 'in_progress'
  | 'fulfilled'
  | 'waived'
  | 'breached'
  | 'rejected'
  | 'cancelled'
  | 'overdue'
  | 'solicitada'
  | 'pendente_formalizacao'
  | 'formalizada'
  | 'em_andamento'
  | 'cumprida'
  | 'rejeitada'
  | 'cancelada'
  | 'vencida';

export interface CoachGuaranteeEffect {
  id: string;
  type: string;
  label: string;
  description: string | null;
  value: number | string | boolean | null;
  applied: boolean;
}

export interface CoachStructuredGuarantee {
  id: string;
  description: string;
  responsibleId: string | null;
  responsibleName: string | null;
  dueAt: string | null;
  status: CoachGuaranteeStatus;
  required: boolean;
  blocksCompletion: boolean;
  effects: CoachGuaranteeEffect[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CoachProposalInformationRequest {
  id: string;
  question: string;
  requestedBy: string | null;
  requestedAt: string | null;
  response: string | null;
  respondedAt: string | null;
}

export interface CoachProposalAvailableActions {
  accept: boolean;
  reject: boolean;
  counter: boolean;
  requestMoreTime: boolean;
  withdraw: boolean;
  provideInformation: boolean;
}

export interface CoachProposalDecisionLog {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  justification: string | null;
  previousStatus: CoachProposalStatus | string | null;
  newStatus: CoachProposalStatus | string;
  terms: Partial<CoachContractTerms> | null;
  createdAt: string | null;
}

export interface CoachProposalDecisionFactor {
  id: string;
  code: string;
  label: string;
  value: number;
  detail: string | null;
}

export interface CoachProposal {
  id: string;
  vacancyId: string | null;
  interviewId: string | null;
  kind: CoachProposalKind;
  sourceContractId: string | null;
  club: CoachClubReference;
  role: string;
  status: CoachProposalStatus;
  terms: CoachContractTerms;
  objectives: CoachBoardObjective[];
  availableBudget: number | null;
  boardExpectation: string | null;
  clubSituation: string | null;
  deadline: string | null;
  proposedStartDate: string | null;
  compensationToCurrentClub: number | null;
  message: string | null;
  negotiationRound: number;
  marketStage: CoachMarketStage;
  nextActionAt: string | null;
  lastActionAt: string | null;
  maxNegotiationRounds: number;
  interviewCompatibility: number | null;
  autonomyDelta: number;
  priorityDelta: number;
  objectiveDifficultyDelta: number;
  decisionScore: number | null;
  decisionReason: string | null;
  decisionFactors: CoachProposalDecisionFactor[];
  competingOfferCount: number;
  informationRequest: CoachProposalInformationRequest | null;
  availableActions: CoachProposalAvailableActions;
  guarantees: CoachStructuredGuarantee[];
  decisionHistory: CoachProposalDecisionLog[];
  canNegotiate: boolean;
  canRequestMoreTime: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CoachCandidateAssessmentFactor {
  code: string;
  label: string;
  weight: number;
  rawScore: number;
  weightedScore: number;
  detail: string | null;
}

export interface CoachCandidateBlocker {
  code: string;
  label: string;
  detail: string | null;
}

export interface CoachCandidateAssessment {
  eligible: boolean;
  score: number;
  factors: CoachCandidateAssessmentFactor[];
  hardBlockers: CoachCandidateBlocker[];
  profileVersion: number;
  evaluatedAt: string | null;
}

export interface CoachVacancyDesiredProfile {
  version: number;
  revision: number;
  tier: 'elite' | 'established' | 'development' | 'small' | string;
  strictness: 'strict' | 'balanced' | 'flexible' | string;
  license: {
    minimum: string;
    allowEquivalent: boolean;
    acceptedEquivalent: string[];
  };
  experience: {
    minimumYears: number;
    youthYears: number;
    professionalYears: number;
    internationalYears: number;
    currentDivisionYears: number;
  };
  geography: {
    country: string | null;
    preferredNationality: string | null;
    acceptedNationalities: string[];
    requiredLanguage: string | null;
    acceptedLanguages: string[];
    regionalExperiencePreferred: boolean;
  };
  salary: {
    minimum: number;
    ideal: number;
    maximum: number;
    flexibility: number;
  };
  achievements: {
    minimumNationalTitles: number;
    minimumCups: number;
    minimumContinentalTitles: number;
    minimumPromotions: number;
    prioritizeYouthDevelopment: boolean;
    prioritizeLeagueSurvival: boolean;
  };
  playingStyle: {
    preferred: string[];
    accepted: string[];
    preferredFormation: string | null;
    acceptedFormations: string[];
    trainingIntensity: string;
    youthUsage: string;
  };
  squad: {
    playerCount: number;
    averageAge: number;
    averageOverall: number;
    averagePotential: number;
    youngTalentCount: number;
    youthShare: number;
    predominantFormation: string;
    attackingScore: number;
    defendingScore: number;
    paceScore: number;
    possessionScore: number;
    rebuilding: boolean;
  };
  countryKnowledge: {
    minimum: number;
    priorWorkPreferred: boolean;
    languageRequired: boolean;
  };
  weights: Record<string, number>;
  objective: string | null;
  availableBudget: number | null;
  squadSummary: string | null;
  reason: string | null;
  generatedAt: string | null;
}

export interface CoachVacancy {
  id: string;
  club: CoachClubReference;
  status: CoachVacancyStatus;
  marketStage: CoachMarketStage;
  shortlistCount: number;
  searchStartedAt: string | null;
  lastMarketActionAt: string | null;
  competition: string | null;
  country: string | null;
  financialSituation: string | null;
  currentPosition: string | null;
  objective: string | null;
  availableBudget: number | null;
  squadSummary: string | null;
  reason: string | null;
  deadline: string | null;
  interestLevel: number | null;
  applicationId: string | null;
  desiredProfile: CoachVacancyDesiredProfile | null;
  createdAt: string | null;
}

export interface CoachApplication {
  id: string;
  vacancyId: string;
  club: CoachClubReference | null;
  status: CoachApplicationStatus;
  message: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  feedback: string | null;
  closedAt: string | null;
  closureReason: string | null;
  closedBy: string | null;
  candidateAssessment: CoachCandidateAssessment | null;
}

export interface CoachInterviewOption {
  id: string;
  label: string;
}

export interface CoachInterviewQuestion {
  id: string;
  prompt: string;
  helpText: string | null;
  type: 'choice' | 'text';
  options: CoachInterviewOption[];
}

export interface CoachInterviewAnswer {
  questionId: string;
  optionId?: string;
  text?: string;
}

export interface CoachInterviewTranscriptEntry {
  id: string;
  questionId: string | null;
  role: 'board' | 'coach';
  text: string;
  topic: string | null;
  createdAt: string | null;
  turn: number;
}

export interface CoachInterviewEvaluationMetrics {
  boardConfidence: number;
  clubCompatibility: number;
  squadCompatibility: number;
  leadership: number;
  tacticalVision: number;
  financialAlignment: number;
  longTermPotential: number;
  culturalFit: number;
  credibility: number;
  perceivedRisk: number;
}

export type CoachInterviewRecommendation = 'hire' | 'hire_with_reservations' | 'negotiate' | 'observe' | 'reject';

export interface CoachInterviewEvaluation {
  overallScore: number;
  metrics: CoachInterviewEvaluationMetrics;
  strengths: string[];
  risks: string[];
  recommendation: CoachInterviewRecommendation;
  summary: string | null;
  generatedAt: string | null;
}

export interface CoachInterviewRelationshipImpact {
  boardConfidenceDelta: number;
  credibilityDelta: number;
  strategicAlignmentDelta: number;
  culturalCompatibilityDelta: number;
  perceivedRiskDelta: number;
  expectedTenureDelta: number;
}

export interface CoachInterviewNegotiationEffects {
  salaryMultiplier: number;
  durationYearsDelta: number;
  signingBonusMultiplier: number;
  performanceBonusMultiplier: number;
  terminationClauseMultiplier: number;
  transferBudgetMultiplier: number;
  autonomyDelta: number;
  priorityDelta: number;
  objectiveDifficultyDelta: number;
  terminateNegotiation: boolean;
  objectives: string[];
  specialClauses: string[];
}

export interface CoachInterview {
  id: string;
  vacancyId: string | null;
  proposalId: string | null;
  club: CoachClubReference;
  status: CoachInterviewStatus;
  scheduledAt: string | null;
  deadline: string | null;
  questions: CoachInterviewQuestion[];
  answers: CoachInterviewAnswer[];
  mode: CoachInterviewMode;
  depth: CoachInterviewDepth;
  source: CoachInterviewSource;
  transcript: CoachInterviewTranscriptEntry[];
  currentQuestionId: string | null;
  turnCount: number;
  minTurns: number;
  maxTurns: number;
  revision: number;
  memorySummary: string | null;
  evaluation: CoachInterviewEvaluation | null;
  relationshipImpact: CoachInterviewRelationshipImpact | null;
  negotiationEffects: CoachInterviewNegotiationEffects | null;
  compatibility: number | null;
  outcome: string | null;
  updatedAt: string | null;
}

export interface CoachEmploymentHistoryEntry {
  id: string;
  club: CoachClubReference;
  role: string;
  status: CoachEmploymentStatus;
  startedAt: string | null;
  endedAt: string | null;
  entryReason: string | null;
  exitReason: string | null;
  matches: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  titles: string[];
}

export interface CoachCareerHistoryMetrics {
  matches: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifference: number | null;
  points: number | null;
  pointsPerGame: number | null;
  winRate: number | null;
  longestWinningStreak: number | null;
  longestWinlessStreak: number | null;
}

export interface CoachCareerHistoryContract {
  id: string;
  startDate: string | null;
  endDate: string | null;
  endedAt: string | null;
  salary: number | null;
  signingBonus: number | null;
  releaseClause: number | null;
  status: string | null;
  endReason: string | null;
  clauses: string[];
}

export interface CoachCareerHistoryTitle {
  id: string;
  name: string;
  type: string | null;
  competition: string | null;
  season: string | null;
  wonAt: string | null;
  club: CoachClubReference | null;
}

export interface CoachCareerHistoryAchievement {
  id: string;
  type: string;
  title: string;
  description: string | null;
  occurredAt: string | null;
  season: string | null;
  club: CoachClubReference | null;
  value: number | null;
}

export interface CoachCareerHistorySpell extends CoachEmploymentHistoryEntry {
  country: string | null;
  division: string | null;
  durationDays: number | null;
  startedSeason: string | null;
  endedSeason: string | null;
  initialSalary: number | null;
  finalSalary: number | null;
  reputationStart: number | null;
  reputationEnd: number | null;
  metrics: CoachCareerHistoryMetrics;
  contracts: CoachCareerHistoryContract[];
  renewals: CoachCareerHistoryContract[];
  titleEntries: CoachCareerHistoryTitle[];
  achievements: CoachCareerHistoryAchievement[];
  development: {
    youthPromoted: number | null;
    signings: number | null;
    sales: number | null;
    squadValueStart: number | null;
    squadValueEnd: number | null;
  };
}

export interface CoachCareerHistorySummary extends CoachCareerHistoryMetrics {
  clubs: number | null;
  countries: number | null;
  seasons: number | null;
  careerDays: number | null;
  titles: number | null;
  promotions: number | null;
  relegations: number | null;
  finals: number | null;
  finalsWon: number | null;
  dismissals: number | null;
  resignations: number | null;
  renewals: number | null;
  proposalsAccepted: number | null;
  proposalsRejected: number | null;
  interviews: number | null;
  unemploymentDays: number | null;
}

export interface CoachCareerHistoryTimelineEntry {
  id: string;
  type: string;
  title: string;
  description: string | null;
  occurredAt: string | null;
  season: string | null;
  club: CoachClubReference | null;
  country: string | null;
  division: string | null;
  reputationDelta: number | null;
  financialImpact: number | null;
}

export interface CoachCareerHistoryNegotiation {
  id: string;
  type: string;
  status: string;
  outcome: string | null;
  occurredAt: string | null;
  expiresAt: string | null;
  club: CoachClubReference | null;
  salary: number | null;
  durationMonths: number | null;
  description: string | null;
  proposalId: string | null;
  interviewId: string | null;
}

export interface CoachCareerHistoryReputationEntry {
  id: string;
  occurredAt: string | null;
  season: string | null;
  club: CoachClubReference | null;
  country: string | null;
  scope: string | null;
  before: number | null;
  after: number | null;
  delta: number | null;
  reason: string | null;
}

export interface CoachCareerHistoryFinancialEntry {
  id: string;
  type: string;
  occurredAt: string | null;
  club: CoachClubReference | null;
  salary: number | null;
  amount: number | null;
  description: string | null;
  contractId: string | null;
}

export interface CoachCareerHistoryUnemploymentPeriod {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  durationDays: number | null;
  reason: string | null;
  interviews: number | null;
  proposals: number | null;
  refusals: number | null;
}

export interface CoachCareerHistory {
  summary: CoachCareerHistorySummary;
  timeline: CoachCareerHistoryTimelineEntry[];
  spells: CoachCareerHistorySpell[];
  negotiations: CoachCareerHistoryNegotiation[];
  reputationHistory: CoachCareerHistoryReputationEntry[];
  achievements: CoachCareerHistoryAchievement[];
  financialHistory: CoachCareerHistoryFinancialEntry[];
  unemploymentPeriods: CoachCareerHistoryUnemploymentPeriod[];
}

export interface CoachCareerAlert {
  id: string;
  kind: string;
  title: string;
  message: string;
  createdAt: string | null;
  read: boolean;
  tone: 'neutral' | 'positive' | 'warning' | 'danger' | 'info';
}

export interface CoachCareerSnapshot {
  coach: CoachProfile;
  activeEmployment: CoachEmployment | null;
  lifecycle?: CoachLifecycleSnapshot;
  marketRestriction: CoachMarketRestriction | null;
  careerTrust: CoachCareerTrust;
  careerAudit: CoachCareerConductEntry[];
  reputationHistory: CoachCareerConductEntry[];
  jobSecurity: CoachJobSecurity | null;
  assignments: CoachEmploymentHistoryEntry[];
  contracts: CoachContract[];
  proposals: CoachProposal[];
  vacancies: CoachVacancy[];
  applications: CoachApplication[];
  interviews: CoachInterview[];
  news: CoachCareerAlert[];
  careerHistory?: CoachCareerHistory;
  updatedAt: string | null;
}

export interface Player {
  id: string;
  name: string;
  shortName: string;
  isStar: boolean;
  number: number;
  position: PlayerPosition;
  role: string;
  age: number;
  nationality: string;
  value: number;
  wage: number;
  condition: number;
  morale: Morale;
  moraleScore?: number;
  status: PlayerStatus;
  injuryMatches?: number;
  suspensionMatches?: number;
  seasonStats?: PlayerSeasonStats;
  competitionStats?: PlayerCompetitionStats[];
  careerStats?: PlayerCareerStats;
  clubId?: string | null;
  currentClubId?: string | null;
  ownerClubId?: string | null;
  overall?: number;
  potential?: number;
  academy?: boolean;
  youth?: boolean;
  retired?: boolean;
  careerStage?: CareerStage;
  contract?: CareerContract;
  contractHistory?: CareerContractHistoryEntry[];
  transferHistory?: CareerTransferHistoryEntry[];
  competitionRegistrations?: CareerCompetitionRegistration[];
  training?: CareerTrainingPlan;
  generatedSeason?: number;
  promotedSeason?: number;
  foot: 'Direito' | 'Esquerdo' | 'Não informado';
  personality: string;
  worldStar?: number;
  attributes: Record<AttributeKey, number>;
  /** Campos ausentes no catálogo de origem; valores de compatibilidade não são dados confirmados. */
  catalogUnknownFields?: PlayerCatalogUnknownField[];
  /** Atributos individuais ausentes no catálogo de origem. */
  catalogUnknownAttributes?: AttributeKey[];
  avatarImageUrl?: string | null;
}

export type MarketListingMode = 'direct' | 'auction';
export type MarketDealType = 'transfer' | 'loan';
export type MarketListingStatus = 'open' | 'completed' | 'expired' | 'cancelled';
export type MarketOfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'cancelled' | 'expired';
export type MarketOfferDirection = 'incoming' | 'outgoing';
export type MarketResponseAction = 'accept' | 'reject' | 'counter' | 'cancel';

export interface MarketPlayerSummary {
  id: string;
  name: string;
  position: PlayerPosition;
  age: number;
  overall: number;
  value: number;
  clubId: string;
  clubName: string;
  isStar: boolean;
  avatarImageUrl?: string | null;
}

export interface MarketContractTerms {
  wage: number;
  durationSeasons: number;
  effectiveSeason?: number;
}

export interface MarketLoanTerms {
  fee: number;
  wageSharePercent: number;
  durationRounds: number;
  purchaseOption: number | null;
  purchaseObligation?: number | null;
}

export interface MarketListing {
  id: string;
  mode: MarketListingMode;
  dealType: MarketDealType;
  status: MarketListingStatus;
  player: MarketPlayerSummary;
  sellerClubId: string;
  sellerClubName: string;
  askingPrice: number | null;
  minimumBid: number | null;
  currentBid: number | null;
  bidCount: number;
  expiresAt: string | null;
  loanTerms?: MarketLoanTerms | null;
  ownListing: boolean;
  canBid: boolean;
  canOffer: boolean;
  createdAt?: string | null;
  revision?: number;
}

export interface MarketOfferPermissions {
  accept: boolean;
  reject: boolean;
  counter: boolean;
  cancel: boolean;
}

export interface MarketOffer {
  id: string;
  listingId?: string | null;
  player: MarketPlayerSummary;
  buyerClubId: string;
  buyerClubName: string;
  sellerClubId: string;
  sellerClubName: string;
  dealType: MarketDealType;
  amount: number;
  counterAmount?: number | null;
  contractTerms?: MarketContractTerms | null;
  loanTerms?: MarketLoanTerms | null;
  status: MarketOfferStatus;
  direction: MarketOfferDirection;
  permissions: MarketOfferPermissions;
  message?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  revision?: number;
}

export interface MarketActiveLoan {
  id: string;
  player: MarketPlayerSummary;
  lenderClubId: string;
  lenderClubName: string;
  borrowerClubId: string;
  borrowerClubName: string;
  fee: number;
  wage: number;
  wageSharePercent: number;
  purchaseOption: number | null;
  purchaseObligation?: number | null;
  canExerciseOption?: boolean;
  remainingRounds: number;
  startedAt?: string | null;
  endsAt?: string | null;
}

export interface MarketTransaction {
  id: string;
  player: MarketPlayerSummary;
  dealType: MarketDealType;
  eventType?: string;
  fromClubId: string | null;
  fromClubName: string;
  toClubId: string;
  toClubName: string;
  amount: number;
  contractTerms?: MarketContractTerms | null;
  loanTerms?: MarketLoanTerms | null;
  completedAt: string;
  status?: 'scheduled' | 'completed' | 'cancelled';
  effectiveSeason?: number;
}

export interface MarketScheduledTransfer {
  id: string;
  playerId: string;
  playerSnapshot?: Player;
  fromClubId: string;
  toClubId: string;
  amount: number;
  reservedAmount: number;
  contractTerms: MarketContractTerms;
  effectiveSeason: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  agreedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  transactionId: string;
}

export interface MarketActivity {
  id: string;
  message: string;
  actorName?: string | null;
  createdAt: string;
  type?: string;
}

export interface MarketFinance {
  clubId: string;
  balance: number;
  committed: number;
  available: number;
  cashAvailable?: number;
  transferBudget?: number;
  transferAvailable?: number;
  wageBudget?: number;
  monthlyPayroll?: number;
  paidPlayers?: number;
}

export interface MarketSnapshot {
  revision: number;
  serverTime: string;
  finance: MarketFinance;
  listings: MarketListing[];
  candidates: MarketPlayerSummary[];
  offers: MarketOffer[];
  activeLoans: MarketActiveLoan[];
  scheduledTransfers: MarketScheduledTransfer[];
  transactions: MarketTransaction[];
  activity: MarketActivity[];
}

export interface ClubFinancialTransaction {
  id: string;
  originId: string;
  operationId: string;
  clubId: string;
  direction: 'income' | 'expense';
  type: 'income' | 'expense';
  category: string;
  amount: number;
  signedAmount: number;
  occurredAt: string;
  completedAt: string;
  description: string | null;
  source: string;
  status: 'completed';
  periodKey: string | null;
  relatedClubId?: string | null;
  counterpartyClubId?: string | null;
  playerId?: string | null;
  contractId?: string | null;
  competitionId?: string | null;
  matchId?: string | null;
  projectId?: string | null;
  metadata: Record<string, unknown>;
  balanceBefore: number | null;
  balanceAfter: number;
  seasonNumber: number;
  createdAt: string;
}

export interface ClubFinancialCategoryAggregate {
  income: number;
  expenses: number;
  count: number;
}

export interface ClubFinancialMonthlyAggregate {
  clubId: string;
  periodKey: string;
  income: number;
  expenses: number;
  net: number;
  count: number;
  byCategory: Record<string, ClubFinancialCategoryAggregate>;
}

export interface ClubFinancialYearlyAggregate {
  clubId: string;
  year: number;
  income: number;
  expenses: number;
  net: number;
  count: number;
  byCategory: Record<string, ClubFinancialCategoryAggregate>;
}

export interface ClubFinancialAggregateState {
  version: number;
  monthly: ClubFinancialMonthlyAggregate[];
  yearly: ClubFinancialYearlyAggregate[];
  totals: Array<Omit<ClubFinancialMonthlyAggregate, 'periodKey'>>;
}

export interface ClubFinanceProfile {
  clubId: string;
  financeLimitsVersion?: number;
  transferBudget?: number;
  wageBudget?: number;
  payroll?: number;
  staffPayroll?: number;
  debts?: number;
  debtMonthlyPayment?: number;
  maintenanceMonthly: number;
  broadcastRights?: {
    monthlyAmount: number;
    startsAt: string | null;
    endsAt: string | null;
  };
  sponsors?: Array<{
    id: string;
    name: string;
    annualValue: number;
    startsAt: string | null;
    endsAt: string | null;
    status: 'active' | 'ended';
  }>;
  sponsor: {
    name: string | null;
    monthlyAmount: number;
    startsAt: string | null;
    endsAt: string | null;
  };
  reservations: Array<{
    id: string;
    amount: number;
    status: 'active' | 'released';
    createdAt: string | null;
    releasedAt: string | null;
  }>;
}

export interface ClubFacilityUpgradeQuote {
  areaId: string;
  name: string;
  category: 'stadium' | 'infrastructure';
  currentLevel: number;
  nextLevel: number;
  cost: number;
  durationDays: number;
  maintenanceIncrease: number;
  benefit: string;
  benefitLabel: string;
}

export interface ClubFacilityArea {
  id: string;
  name: string;
  category: 'stadium' | 'infrastructure';
  level: number;
  maxLevel: number;
  maintenanceCost: number;
  benefit: string;
  activeProjectId: string | null;
  /** Campos calculados pelo servidor; nunca persistidos no save. */
  benefitLabel: string;
  upgradeStatus: 'available' | 'active' | 'max';
  nextUpgradeQuote: ClubFacilityUpgradeQuote | null;
}

export interface ClubFacilityProject {
  id: string;
  operationId: string;
  clubId: string;
  areaId: string;
  name: string;
  category: 'stadium' | 'infrastructure';
  fromLevel: number;
  toLevel: number;
  cost: number;
  durationDays: number;
  startedAt: string;
  expectedAt: string;
  completedAt: string | null;
  status: 'active' | 'completed' | 'cancelled';
}

export interface ClubStadiumState {
  name: string;
  capacity: number;
  usedCapacity: number;
  averageAttendance: number;
  matchesHosted: number;
  totalAttendance: number;
  condition: number;
  pitchQuality: number;
  lighting: number;
  coverage: number;
  security: number;
  comfort: number;
  parking: number;
  commercial: number;
  level: number;
  maintenanceCost: number;
  averageMatchRevenue: number;
  totalMatchRevenue: number;
  averageTicketPrice: number;
  renovationHistory: Array<Record<string, unknown>>;
  matchHistory: Array<Record<string, unknown>>;
  /** Compatibilidade com saves antigos; uniao limitada dos dois historicos canonicos. */
  history: Array<Record<string, unknown>>;
}

export interface ClubFacilityState {
  clubId: string;
  stadium: ClubStadiumState;
  areas: ClubFacilityArea[];
}

export interface ClubStaffContract {
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

export interface ClubStaffMember {
  id: string;
  name: string;
  role: string;
  age: number;
  nationality: string;
  reputation: number;
  attributes: Record<string, number>;
  salary: number;
  clubId: string | null;
  contractId: string | null;
  specialties: string[];
  satisfaction: number;
  status: 'employed' | 'free_agent' | 'retired' | 'suspended' | 'on_leave';
  affiliationType?: ProfessionalAffiliationType;
  linkedCoachId?: string | null;
  linkedCoachName?: string | null;
  lifecycleStatus?: string | null;
  noticeEndsAt?: string | null;
  retirementAt?: string | null;
  interimAssignment?: {
    id?: string;
    clubId: string;
    role?: string;
    startedAt?: string | null;
    startsAt: string | null;
    expectedEndAt?: string | null;
    endedAt?: string | null;
    endsAt: string | null;
    authorityLevel: number | null;
    status: string;
    endReason?: string | null;
    temporaryBonus?: number;
    sourceCoachId?: string | null;
    confirmedAppointmentId?: string | null;
  } | null;
  professionalHistory: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export interface ClubStaffEffects {
  clubId: string;
  memberCount: number;
  quality: number;
  monthlyCost: number;
  trainingDevelopmentMultiplier: number;
  conditionRecoveryBonus: number;
  injuryRiskMultiplier: number;
  injuryRecoveryMultiplier: number;
  scoutingConfidenceBonus: number;
  scoutingSpeedMultiplier: number;
  tacticalAnalysisBonus: number;
  cohesionGainBonus: number;
  cohesionChangePenaltyMultiplier: number;
  goalkeeperDevelopmentMultiplier: number;
  youthIntakeQualityBonus: number;
  moraleRecoveryBonus: number;
  negotiationBonus: number;
  sourceStaffIds: string[];
  calculatedAt: string;
}

export interface CareerDomainEvent {
  id: string;
  operationId: string;
  type: string;
  occurredAt: string;
  seasonNumber: number | null;
  clubIds: string[];
  playerIds: string[];
  competitionId: string | null;
  matchId: string | null;
  payload: Record<string, unknown>;
}

export interface CareerNewsItem {
  id: string;
  eventId: string;
  eventType: string;
  originOperationId: string;
  title: string;
  summary: string;
  content: string;
  publishedAt: string;
  date: string;
  category: string;
  importance: 'normal' | 'alta';
  clubIds: string[];
  playerIds: string[];
  competitionId: string | null;
  visualType: string;
  readByManagerIds: string[];
  readAtByManagerId: Record<string, string>;
}

export interface ClubCareerState {
  version: number;
  currentDate: string;
  financialTransactions: ClubFinancialTransaction[];
  financialAggregates?: ClubFinancialAggregateState;
  financialOriginIndex?: string[];
  financeProfiles: ClubFinanceProfile[];
  lastFinancialPeriodByClub: Record<string, string>;
  clubFacilities: ClubFacilityState[];
  facilityProjects: ClubFacilityProject[];
  staffMembers: ClubStaffMember[];
  staffCandidates: ClubStaffMember[];
  staffContracts: ClubStaffContract[];
  staffHistory: Array<Record<string, unknown>>;
  professionalLifecycle?: ProfessionalLifecycleRecord[];
  staffEffectsByClub: Record<string, ClubStaffEffects>;
  staffInitializedClubIds: string[];
  staffSchemaVersion: number;
  processedStaffOperationIds: string[];
  financialAlerts?: Array<Record<string, unknown>>;
  events: CareerDomainEvent[];
  news: CareerNewsItem[];
  processedEventIds: string[];
}

export interface MarketUpdatedEvent {
  code: string;
  revision: number;
  reason: string;
}

export interface MarketMutationResponse {
  snapshot?: MarketSnapshot;
  revision?: number;
  listing?: MarketListing;
  offer?: MarketOffer;
  transaction?: MarketTransaction;
  cancelled?: boolean;
}

export interface MarketOfferInput {
  playerId: string;
  listingId?: string;
  dealType: MarketDealType;
  amount: number;
  message?: string;
  contractTerms?: MarketContractTerms;
  loanTerms?: MarketLoanTerms;
  noticeApproval?: boolean;
}

export interface MarketListingInput {
  playerId: string;
  mode: MarketListingMode;
  dealType: MarketDealType;
  askingPrice?: number;
  minimumBid?: number;
  expiresInHours?: number;
  loanTerms?: MarketLoanTerms;
  noticeApproval?: boolean;
}

export interface PressConferenceAnswerInput {
  questionId: string;
  answerId: string;
}

export interface PressConferencePlayerMoraleChange {
  playerId: string;
  delta: number;
  moraleScore: number;
}

export interface PressConferenceEffects {
  squadMoraleDelta: number;
  squadMoraleScore: number;
  playerMoraleChanges: PressConferencePlayerMoraleChange[];
  sectorDeltas: {
    defense: number;
    midfield: number;
    attack: number;
  };
}

export interface PressConferenceSubmissionResponse {
  submission: PressConferenceSubmission;
  alreadySubmitted: boolean;
  effects: PressConferenceEffects;
  post?: unknown;
  room?: Room;
}

export interface PressConferenceSubmission {
  managerId: string;
  clubId: string;
  clubName: string;
  clubSide: 'home' | 'away';
  matchId: string;
  answers: PressConferenceAnswerInput[];
  effects: PressConferenceEffects;
  submittedAt: string;
}

export interface StarImpactPlayer {
  id: string;
  name: string;
}

export interface StarImpactProfile {
  clubId: string;
  catalogPlayerCount: number;
  starCount: number;
  starPlayers: StarImpactPlayer[];
  matchStrengthBonus: number;
  sponsorBoostPercent: number;
  sponsorAnnualBonus: number;
  source?: string;
}

export interface LeagueTeam {
  clubId?: string;
  position: number;
  name: string;
  code: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalDifference: number;
  points: number;
  form: Array<'V' | 'E' | 'D'>;
  accent: string;
  darkThemeColor?: string | null;
  lightThemeColor?: string | null;
  crestImageUrl?: string | null;
}

export type MatchEventKind = 'info' | 'chance' | 'goal-home' | 'goal-away' | 'card' | 'sub' | 'whistle' | 'injury';

export interface MatchEvent {
  id?: string;
  minute: number;
  kind: MatchEventKind;
  text: string;
  score?: [number, number];
  type?: ServerMatchEventType;
  side?: 'home' | 'away';
  team?: string;
  teamId?: string;
  playerId?: string;
  scorerId?: string;
  scorer?: string;
  assist?: string | null;
  assistId?: string | null;
  fouledPlayerId?: string;
  severity?: 'minor' | 'moderate' | 'severe';
  injuryMatches?: number;
  suspensionMatches?: number;
  substitution?: ServerMatchSubstitution;
}

export interface FormationSlot {
  id: string;
  role: PlayerPosition;
  x: number;
  y: number;
}

export interface Formation {
  id: string;
  name: string;
  description: string;
  slots: FormationSlot[];
}

export type TacticMentality = 'cautious' | 'balanced' | 'positive' | 'attacking';
export type PressureLineInstruction = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';
export type WidthInstruction = 'very-narrow' | 'narrow' | 'normal' | 'wide' | 'very-wide';
export type TempoInstruction = 'very-slow' | 'slow' | 'normal' | 'fast' | 'very-fast';
export type PressingInstruction = 'passive' | 'moderate' | 'intense' | 'aggressive';
export type OffensiveTransitionInstruction = 'build-up' | 'direct' | 'counter';
export type DefensiveTransitionInstruction = 'counter-press' | 'regroup' | 'drop';

export interface TeamInstructions {
  pressureLine: PressureLineInstruction;
  width: WidthInstruction;
  tempo: TempoInstruction;
  pressing: PressingInstruction;
  offensiveTransition: OffensiveTransitionInstruction;
  defensiveTransition: DefensiveTransitionInstruction;
}

export type IndividualWithBallInstruction = 'support-inside' | 'hold-width' | 'attack-space';
export type IndividualWithoutBallInstruction = 'press-more' | 'hold-position' | 'man-mark';

export interface IndividualTacticInstruction {
  playerId: string;
  withBall: IndividualWithBallInstruction;
  withoutBall: IndividualWithoutBallInstruction;
}

export interface TacticSetPieces {
  corner: {
    takerId: string | null;
    routine: 'short' | 'near-post' | 'far-post';
  };
  freeKick: {
    takerId: string | null;
    routine: 'direct' | 'cross' | 'short';
  };
  goalKick: {
    takerId: string | null;
    routine: 'short' | 'mixed' | 'long';
  };
}

export interface TacticPlanV1 {
  version: 1;
  formationId: string;
  mentality: TacticMentality;
  teamInstructions: TeamInstructions;
  individualInstructions: IndividualTacticInstruction[];
  setPieces: TacticSetPieces;
  secret: boolean;
}

export interface TeamCohesionState {
  score: number;
  formationId: string;
  orderedLineupIds: string[];
  lineupSignature: string;
  tacticFingerprint: string;
  stableMatches: number;
  outOfPositionCount: number;
  exactPositionCount: number;
  changeImpact: number;
  updatedAt?: string;
}

export interface TacticalSectorMatchup {
  attackVsDefense: number;
  midfieldControl: number;
  defensiveSecurity: number;
}

export interface TacticalMatchupSide {
  edge: number;
  modifier: number;
  sectors: TacticalSectorMatchup;
}

export interface TacticalMatchupReason {
  code: string;
  side: 'home' | 'away';
  label: string;
  impact: number;
}

export interface TacticalMatchup {
  version: 1;
  home: TacticalMatchupSide;
  away: TacticalMatchupSide;
  reasons: TacticalMatchupReason[];
}

export type OpponentStudyDepth = 'quick' | 'standard' | 'deep';

export interface OpponentStudyPlayer {
  id: string;
  name: string;
  position: PlayerPosition;
  rating: number;
  reason: string;
}

export interface OpponentStudySector {
  key: 'goalkeeping' | 'defense' | 'midfield' | 'attack' | 'physical';
  label: string;
  rating: number;
  level: 'strong' | 'balanced' | 'vulnerable';
}

export interface OpponentStudyInsight {
  code: string;
  label: string;
  detail: string;
  side?: 'home' | 'away' | 'neutral';
}

export interface OpponentStudy {
  fixtureId: string | null;
  opponentClubId: string;
  opponentName: string;
  depth: OpponentStudyDepth;
  confidence: number;
  estimatedStudyHours: number;
  scoutingSpeedMultiplier: number;
  source: 'observed' | 'estimated';
  probableFormation: string;
  style: string;
  probableLineup: OpponentStudyPlayer[];
  dangerousPlayers: OpponentStudyPlayer[];
  sectors: OpponentStudySector[];
  strengths: OpponentStudyInsight[];
  weaknesses: OpponentStudyInsight[];
  recommendations: OpponentStudyInsight[];
  generatedAt?: string;
}

export interface NewsItem {
  id: string;
  source: string;
  sourceType: 'imprensa' | 'clube' | 'jogador' | 'torcida';
  time: string;
  headline: string;
  body: string;
  reactions: number;
  tag: string;
}

export type NewsEditorialSourceType = NewsItem['sourceType'];
export type NewsSourceType = NewsEditorialSourceType | 'manager';
export type NewsAiRole = 'torcida' | 'imprensa' | 'jogador' | 'clube' | 'manager';
export type NewsAiSentiment = 'positivo' | 'neutro' | 'critico';

export interface NewsAiCommentDto {
  id?: string;
  author?: string;
  role?: string;
  text?: string;
  sentiment?: string;
  parentCommentId?: string | null;
  createdAt?: string | null;
}

export interface NewsAiComment {
  id: string;
  author: string;
  role: NewsAiRole;
  text: string;
  sentiment: NewsAiSentiment;
  parentCommentId: string | null;
  createdAt: string | null;
}

export interface NewsPostDto {
  id?: string;
  roomCode?: string;
  editorialKey?: string | null;
  authorId?: string;
  authorName?: string;
  clubId?: string | null;
  source?: string;
  sourceType?: string;
  time?: string;
  createdAt?: string;
  headline?: string;
  body?: string;
  reactions?: number;
  tag?: string;
  comments?: NewsAiCommentDto[];
}

export interface NewsPost {
  id: string;
  roomCode: string | null;
  editorialKey: string | null;
  authorId: string | null;
  authorName: string | null;
  clubId: string | null;
  source: string;
  sourceType: NewsSourceType;
  time: string;
  createdAt: string | null;
  headline: string;
  body: string;
  reactions: number;
  tag: string;
  comments: NewsAiComment[];
}

export interface NewsAiReplyDto {
  postId?: string;
  comments?: NewsAiCommentDto[];
}

export interface NewsAiRequestPost {
  id: string;
  source: string;
  sourceType: NewsEditorialSourceType;
  headline: string;
  body: string;
  tag?: string;
  reactions?: number;
}

export interface NewsFeedApiResponse {
  posts?: NewsPostDto[];
  source?: string;
}

export interface NewsAiApiResponse {
  teamComment?: NewsAiCommentDto | null;
  replies?: NewsAiReplyDto[];
  posts?: NewsPostDto[];
}

export interface NewsPublishApiResponse {
  post?: NewsPostDto;
  generatedPost?: NewsPostDto | null;
  teamComment?: NewsAiCommentDto | null;
}

export interface NewsCommentReplyApiResponse {
  post?: NewsPostDto;
  comments?: NewsAiCommentDto[];
  generatedPost?: NewsPostDto | null;
}

export type AuthMode = 'firebase' | 'demo';
export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface ManagerIdentity {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  mode: AuthMode;
}

export interface ClubChoice {
  id: string;
  name: string;
  code: string;
  city: string;
  stars: number;
  budget: string;
  color: string;
  darkThemeColor?: string | null;
  lightThemeColor?: string | null;
  crestImageUrl?: string | null;
  stadium?: string;
  stadiumCapacity?: number;
  leagueId?: string | null;
  leagueName?: string | null;
  division?: string | null;
  country?: string | null;
}

export interface LeagueChoice {
  id: string;
  name: string;
  country: string;
  division: string;
  level: number;
  clubCount: number;
}

export interface RoomClubSnapshot {
  id: string;
  name: string;
  code: string;
  color: string;
  darkThemeColor?: string | null;
  lightThemeColor?: string | null;
  reputation: number;
  crestImageUrl: string | null;
  stadium?: string;
  stadiumCapacity?: number;
  leagueId: string;
}

export interface RoomLeagueSnapshot {
  id: string;
  name: string;
  country: string;
  division: string;
  level?: number;
  legs: TournamentLegs;
  clubs: RoomClubSnapshot[];
}

export interface TournamentParticipant {
  id: string;
  name: string;
  abbreviation: string;
  colors: string[];
  darkThemeColor?: string | null;
  lightThemeColor?: string | null;
  country: string | null;
  division: string | null;
  leagueId?: string | null;
  reputation?: number;
  stadium?: string | null;
  stadiumCapacity?: number;
  crestImageUrl: string | null;
  crestImagePath: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  teamCount: number;
  legs: TournamentLegs;
  tiebreakers: TournamentTiebreaker[];
  teamIds: string[];
  trophyImageUrl: string | null;
  trophyImagePath: string | null;
  active: boolean;
  participants: TournamentParticipant[];
}

export type CompetitionStatus = 'scheduled' | 'active' | 'completed';
export type CompetitionStageType = 'league' | 'groups' | 'knockout';
export type CompetitionTiebreaker = TournamentTiebreaker | 'points';

export interface CompetitionParticipant {
  id: string;
  name: string;
  seed: number;
}

export interface CompetitionSchedule {
  startDate: string;
  roundIntervalDays: number;
  knockoutLegIntervalDays: number;
  knockoutRoundIntervalDays: number;
  kickoffTimes: string[];
}

export interface CompetitionFixtureResult {
  score: [number, number];
  extraTime: [number, number] | null;
  penalties: [number, number] | null;
  fairPlay: [number, number];
  winnerClubId: string | null;
}

export interface CompetitionFixture {
  id: string;
  competitionFixtureId: string;
  competitionId: string;
  tournamentId: string;
  seasonNumber: number;
  seasonYear: number;
  stageId: string;
  stage: string;
  stageType: CompetitionStageType;
  groupId: string | null;
  tieId: string | null;
  round: number;
  calendarRound: number;
  matchNumber: number;
  leg: number;
  homeClubId: string;
  awayClubId: string;
  scheduledAt: string;
  status: 'scheduled' | 'completed';
  result: CompetitionFixtureResult | null;
  completedAt: string | null;
}

export interface CompetitionStanding {
  position: number;
  clubId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlay: number;
}

export interface CompetitionLeagueStage {
  id: string;
  type: 'league';
  status: 'active' | 'completed';
  participantIds: string[];
  fixtureIds: string[];
  standings: CompetitionStanding[];
}

export interface CompetitionGroup {
  id: string;
  name: string;
  participantIds: string[];
  fixtureIds: string[];
  standings: CompetitionStanding[];
  qualifiers: string[];
}

export interface CompetitionGroupsStage {
  id: string;
  type: 'groups';
  status: 'active' | 'completed';
  qualifiersPerGroup: number;
  fixtureIds: string[];
  groups: CompetitionGroup[];
  calendarRoundCount: number;
}

export interface CompetitionTieSource {
  type: 'seed' | 'winner';
  id: string | null;
}

export interface CompetitionKnockoutTie {
  id: string;
  round: number;
  order: number;
  homeSource: CompetitionTieSource;
  awaySource: CompetitionTieSource;
  homeClubId: string | null;
  awayClubId: string | null;
  fixtureIds: string[];
  status: 'pending' | 'active' | 'completed' | 'void';
  winnerClubId: string | null;
  aggregate: [number, number] | null;
  decidedBy: string | null;
}

export interface CompetitionKnockoutRound {
  number: number;
  name: string;
  tieIds: string[];
}

export interface CompetitionKnockoutStage {
  id: string;
  type: 'knockout';
  status: 'active' | 'completed';
  startCalendarRound: number;
  fixtureIds: string[];
  rounds: CompetitionKnockoutRound[];
  ties: CompetitionKnockoutTie[];
}

export type CompetitionStage = CompetitionLeagueStage | CompetitionGroupsStage | CompetitionKnockoutStage;

export interface CompetitionState {
  engineVersion: number;
  id: string;
  name: string;
  format: TournamentFormat;
  legs: TournamentLegs;
  tiebreakers: CompetitionTiebreaker[];
  seasonNumber: number;
  seasonYear: number;
  status: CompetitionStatus;
  participants: CompetitionParticipant[];
  schedule: CompetitionSchedule;
  stages: CompetitionStage[];
  fixtures: CompetitionFixture[];
  calendar: string[];
  completedFixtureIds: string[];
  winnerClubId: string | null;
}

export interface CompetitionSeason {
  engineVersion: number;
  seasonNumber: number;
  seasonYear: number;
  status: CompetitionStatus;
  tournamentIds: string[];
  competitions: CompetitionState[];
  fixtures: CompetitionFixture[];
  calendar: string[];
  completedFixtureIds: string[];
  winners: Array<{ tournamentId: string; clubId: string }>;
}

export interface RoomManager {
  id: string;
  name: string;
  clubId: string | null;
  ready: boolean;
  joinedAt: string;
}

export interface RoomFixture {
  fixtureId: string;
  leagueFixtureId?: string;
  competitionFixtureId?: string;
  tournamentId?: string | null;
  stage?: string | null;
  stageType?: CompetitionStageType | null;
  groupId?: string | null;
  tieId?: string | null;
  leg?: number;
  round: number;
  scheduledAt?: string | null;
  competition: string;
  leagueId?: string | null;
  homeClubId: string;
  awayClubId: string;
  homeTeam: string;
  awayTeam: string;
  homeCode?: string;
  awayCode?: string;
  homeColor?: string;
  awayColor?: string;
  homeDarkThemeColor?: string | null;
  homeLightThemeColor?: string | null;
  awayDarkThemeColor?: string | null;
  awayLightThemeColor?: string | null;
  homeCrestImageUrl?: string | null;
  awayCrestImageUrl?: string | null;
  homeStadium?: string;
  homeStadiumCapacity?: number;
  homeManagerId: string | null;
  awayManagerId: string | null;
  managerIds: string[];
}

export interface RoomLeagueFixture {
  leagueFixtureId: string;
  leagueId: string | null;
  round: number;
  scheduledAt?: string | null;
  homeClubId: string;
  awayClubId: string;
}

export interface ServerLeagueMatchResult {
  leagueFixtureId: string;
  score: [number, number];
  possession?: [number, number];
  completedAt?: string | null;
}

export interface RoomScheduleIssue {
  code: 'LEAGUE_NEEDS_CLUBS';
  message: string;
}

export interface MatchReadiness {
  fixtureId: string | null;
  managerIds: string[];
}

export interface RoomLineup {
  managerId: string;
  clubId: string;
  lineupIds: string[];
  tactics?: TacticPlanV1;
  cohesion?: TeamCohesionState;
  updatedAt: string;
}

export interface RoomTacticPreview {
  managerId: string;
  clubId: string;
  formationId: string;
  mentality: TacticMentality;
  teamInstructions: TeamInstructions;
  updatedAt: string;
}

export interface PlayerCompetitionStatsCoverage {
  competitionId: string;
  seasonNumber: number;
  complete: boolean;
  trackedMatches: number;
  untrackedMatches: number;
  metrics: {
    shots: boolean;
    shotsOnTarget: boolean;
    saves: boolean;
    goalsConceded: boolean;
    cleanSheets: boolean;
  };
  lastMatchId: string | null;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  status: 'waiting' | 'active';
  activeLeagues: string[];
  competitionCatalog?: RoomLeagueSnapshot[];
  tournamentCatalog?: Tournament[];
  competitionSeason?: CompetitionSeason | null;
  seasonLength: number;
  unlimitedSeasons: boolean;
  currentSeason: number;
  seasonYear: number;
  seasonStartedAt: string | null;
  seasonHistory: unknown[];
  careerCompleted: boolean;
  maxManagers: number;
  createdAt: string;
  updatedAt?: string;
  startedAt: string | null;
  revision: number;
  version?: number;
  currentFixtureId?: string | null;
  scheduleVersion?: number;
  scheduleIssue?: RoomScheduleIssue | null;
  fixtureSchedule?: RoomFixture[];
  leagueFixtureSchedule?: RoomLeagueFixture[];
  matchReadiness?: MatchReadiness;
  lineups?: RoomLineup[];
  tacticPreviews?: RoomTacticPreview[];
  completedFixtureIds?: string[];
  completedMatches?: ServerMatchFinished[];
  completedFixtureCount?: number;
  completedMatchCount?: number;
  seasonHistoryCount?: number;
  lastCompletedMatch?: ServerMatchFinished | null;
  leagueMatchResults?: ServerLeagueMatchResult[];
  lastCompletedRound?: ServerRoundSummary | null;
  playerCompetitionStatsCoverage?: PlayerCompetitionStatsCoverage[];
  clubCareerState?: ClubCareerState;
  managers: RoomManager[];
}

export interface ServerErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type AckResponse<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; error: ServerErrorPayload };

export interface RoomCreatePayload {
  name: string;
  clubId?: string;
  activeLeagues?: string[];
  seasonLength?: number;
  unlimitedSeasons?: boolean;
  maxManagers?: number;
}

export interface MatchSideStatistics {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  corners: number;
}

export interface MatchStatistics {
  home: MatchSideStatistics;
  away: MatchSideStatistics;
}

export type ServerMatchEventType =
  | 'kickoff'
  | 'attack'
  | 'goal'
  | 'save'
  | 'foul'
  | 'corner'
  | 'yellow-card'
  | 'red-card'
  | 'halftime'
  | 'post'
  | 'injury'
  | 'substitution'
  | 'penalty'
  | 'var'
  | 'fulltime';

export interface ServerMatchSubstitution {
  playerOutId: string;
  playerOutName: string;
  playerInId: string;
  playerInName: string;
}

export interface ServerMatchEvent {
  code: string;
  matchId: string;
  fixtureId: string;
  id: string;
  minute: number;
  type: ServerMatchEventType;
  text: string;
  score: [number, number];
  statistics: MatchStatistics;
  side?: 'home' | 'away';
  team?: string;
  teamId?: string;
  playerId?: string;
  playerName?: string;
  scorerId?: string;
  scorer?: string;
  assist?: string | null;
  assistId?: string | null;
  fouledPlayerId?: string;
  fouledPlayerName?: string;
  goalkeeperId?: string | null;
  goalkeeperName?: string | null;
  committedByPlayerId?: string | null;
  severity?: 'minor' | 'moderate' | 'severe';
  injuryMatches?: number;
  suspensionMatches?: number;
  substitution?: ServerMatchSubstitution;
  skipped: boolean;
}

export type MatchSpeed = 0.5 | 1 | 2 | 3;

export interface ServerMatchSpeed {
  code: string;
  matchId: string;
  rate: MatchSpeed;
  baseDelayMs: number;
  effectiveDelayMs: number;
  changedBy: string | null;
  changedAt: string | null;
}

export interface ServerMatchStarted {
  code: string;
  id: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  eventCount: number;
  delayMs: number;
  speed: ServerMatchSpeed;
  tacticalMatchup?: TacticalMatchup;
  homeFormation?: string;
  awayFormation?: string;
}

export type ServerMatchResultEvent = Omit<ServerMatchEvent, 'code' | 'matchId' | 'fixtureId' | 'skipped'>;

export interface ServerRoundMatchResult {
  id: string;
  fixtureId: string;
  managedFixtureId?: string;
  leagueFixtureId?: string;
  source: 'manager' | 'ai';
  homeClubId?: string | null;
  awayClubId?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  homeCode?: string;
  awayCode?: string;
  homeColor?: string;
  awayColor?: string;
  homeDarkThemeColor?: string | null;
  homeLightThemeColor?: string | null;
  awayDarkThemeColor?: string | null;
  awayLightThemeColor?: string | null;
  homeCrestImageUrl?: string | null;
  awayCrestImageUrl?: string | null;
  score: [number, number] | null;
  completedAt: string | null;
  leagueId?: string | null;
  competition?: string;
  round?: number;
  seasonNumber?: number;
  seasonYear?: number;
}

export interface ServerRoundSummary {
  leagueId: string | null;
  competition: string;
  round: number;
  seasonNumber: number;
  seasonYear: number;
  complete: boolean;
  matches: ServerRoundMatchResult[];
}

export interface ServerPlayerMatchStat {
  playerId: string;
  name: string;
  clubId: string;
  side: 'home' | 'away';
  position: PlayerPosition;
  started: boolean;
  appearance: boolean;
  minutesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  foulsCommitted: number;
  foulsSuffered: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  goalsConceded: number;
  cleanSheet: boolean;
  injuries: number;
  injured: boolean;
}

export interface ServerPlayerMatchEffect {
  playerId: string;
  clubId: string;
  side: 'home' | 'away';
  conditionBefore?: number;
  conditionAfter: number;
  conditionDelta?: number;
  status: PlayerStatus;
  injuryMatches: number;
  injurySeverity?: 'minor' | 'moderate' | 'severe' | null;
  suspensionMatches: number;
}

export interface ServerMatchFinished {
  code: string;
  id: string;
  fixtureId?: string;
  homeTeam: string;
  awayTeam: string;
  score: [number, number];
  statistics: MatchStatistics;
  events?: ServerMatchResultEvent[];
  seed?: string;
  simulationVersion?: number;
  playerStatistics?: {
    home: ServerPlayerMatchStat[];
    away: ServerPlayerMatchStat[];
  };
  playerEffects?: ServerPlayerMatchEffect[];
  skipped: boolean;
  cancelled?: boolean;
  emittedEvents?: number;
  completedAt?: string;
  roomRevision?: number;
  nextFixtureId?: string | null;
  seasonNumber?: number;
  seasonYear?: number;
  nextSeasonNumber?: number | null;
  nextSeasonYear?: number | null;
  roundSummary?: ServerRoundSummary;
  pressConferenceSubmissions?: PressConferenceSubmission[];
  tacticalMatchup?: TacticalMatchup;
  homeFormation?: string;
  awayFormation?: string;
}

export type HalftimeMentality = TacticMentality;
export type HalftimeInstruction = 'keep-plan' | 'exploit-right' | 'keep-possession' | 'high-line' | 'slow-tempo';

export interface HalftimeTactics {
  mentality: HalftimeMentality;
  instruction: HalftimeInstruction;
}

export interface HalftimePlan {
  lineupIds: string[];
  tactics: HalftimeTactics;
  substitutionCount: number;
  savedAt: string;
}

export interface ServerHalftimeState {
  code: string;
  matchId: string;
  fixtureId: string;
  status: 'paused' | 'resuming';
  requiredManagerIds: string[];
  readyManagerIds: string[];
  readyCount: number;
  requiredCount: number;
  allReady: boolean;
  plansSavedManagerIds: string[];
  substitutionCounts: Record<string, number>;
  participant?: boolean;
  ownPlan?: HalftimePlan | null;
}

export interface MatchHalftimeResponse {
  halftime: ServerHalftimeState;
  resumed?: boolean;
}

export interface ServerMatchResumed {
  code: string;
  matchId: string;
  fixtureId?: string;
}

export interface MatchSyncResponse {
  source: 'live' | 'persisted' | 'idle';
  phase?: 'idle' | 'running' | 'halftime' | 'finished';
  started: ServerMatchStarted | null;
  events: ServerMatchEvent[];
  result: ServerMatchFinished | null;
  halftime?: ServerHalftimeState | null;
  speed?: ServerMatchSpeed | null;
}

export interface MatchReadyResponse {
  room: Room;
  started: boolean;
  matchId?: string;
  readyCount: number;
  requiredCount: number;
  allReady: boolean;
}

export interface LineupSaveResponse {
  room: Room;
  lineup: RoomLineup;
  source: string;
  warnings?: Array<{
    code: string;
    message: string;
    playerId?: string;
    role?: PlayerPosition;
    position?: PlayerPosition | null;
  }>;
}

export interface ServerToClientEvents {
  'server:ready': (payload: { socketId: string }) => void;
  'server:error': (payload: { event: string; error: ServerErrorPayload }) => void;
  'room:state': (room: Room) => void;
  'room:started': (room: Room) => void;
  'room:deleted': (payload: { code: string }) => void;
  'match:started': (match: ServerMatchStarted) => void;
  'match:event': (event: ServerMatchEvent) => void;
  'match:halftime': (halftime: ServerHalftimeState) => void;
  'match:resumed': (payload: ServerMatchResumed) => void;
  'match:speed-changed': (speed: ServerMatchSpeed) => void;
  'match:finished': (result: ServerMatchFinished) => void;
  'match:skipped': (payload: { code: string }) => void;
  'news:post': (post: NewsPostDto) => void;
  'market:updated': (payload: MarketUpdatedEvent) => void;
}

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:join': (payload: { code: string; clubId?: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:ready': (payload: { code: string; ready: boolean; clubId?: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:start': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:delete': (payload: { code: string }, acknowledge: (response: AckResponse<{ code: string }>) => void) => void;
  'room:resume': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:sync': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'match:ready': (payload: { code: string; fixtureId?: string; ready: boolean }, acknowledge: (response: AckResponse<MatchReadyResponse>) => void) => void;
  'match:start': (payload: { code: string; fixtureId?: string }, acknowledge: (response: AckResponse<{ matchId: string }>) => void) => void;
  'match:skip': (payload: { code: string }, acknowledge: (response: AckResponse<{ skipped: boolean }>) => void) => void;
  'match:sync': (payload: { code: string }, acknowledge: (response: AckResponse<MatchSyncResponse>) => void) => void;
  'match:halftime-plan': (payload: { code: string; matchId: string; lineupIds: string[]; tactics: HalftimeTactics }, acknowledge: (response: AckResponse<MatchHalftimeResponse>) => void) => void;
  'match:halftime-ready': (payload: { code: string; matchId: string; ready: boolean }, acknowledge: (response: AckResponse<MatchHalftimeResponse>) => void) => void;
  'match:speed': (payload: { code: string; matchId: string; speed: MatchSpeed }, acknowledge: (response: AckResponse<{ changed: boolean; speed: ServerMatchSpeed }>) => void) => void;
  'lineup:save': (payload: { code: string; lineupIds: string[]; tactics?: TacticPlanV1 }, acknowledge: (response: AckResponse<LineupSaveResponse>) => void) => void;
  'market:sync': (payload: { code: string }, acknowledge: (response: AckResponse<{ snapshot: MarketSnapshot }>) => void) => void;
  'market:offer': (payload: { code: string; requestId: string } & MarketOfferInput, acknowledge: (response: AckResponse<MarketMutationResponse>) => void) => void;
  'market:respond': (payload: { code: string; requestId: string; offerId: string; action: MarketResponseAction; counterAmount?: number; noticeApproval?: boolean }, acknowledge: (response: AckResponse<MarketMutationResponse>) => void) => void;
  'market:list': (payload: { code: string; requestId: string } & MarketListingInput, acknowledge: (response: AckResponse<MarketMutationResponse>) => void) => void;
  'market:bid': (payload: { code: string; requestId: string; listingId: string; amount: number; noticeApproval?: boolean }, acknowledge: (response: AckResponse<MarketMutationResponse>) => void) => void;
  'market:cancel-listing': (payload: { code: string; requestId: string; listingId: string }, acknowledge: (response: AckResponse<MarketMutationResponse>) => void) => void;
  'market:exercise-loan-option': (payload: { code: string; requestId: string; loanId: string; noticeApproval?: boolean }, acknowledge: (response: AckResponse<MarketMutationResponse>) => void) => void;
  'club:upgrade': (payload: { code: string; clubId: string; areaId: string; requestId: string; noticeApproval?: boolean }, acknowledge: (response: AckResponse<{ room: Room; project: ClubFacilityProject }>) => void) => void;
  'club:staff-hire': (payload: { code: string; clubId: string; candidateId: string; requestId: string; contractSeasons?: number; salary?: number }, acknowledge: (response: AckResponse<{ room: Room; member: ClubStaffMember }>) => void) => void;
  'club:staff-fire': (payload: { code: string; clubId: string; staffId: string; requestId: string }, acknowledge: (response: AckResponse<{ room: Room; member: ClubStaffMember }>) => void) => void;
  'club:staff-renew': (payload: { code: string; clubId: string; staffId: string; requestId: string; contractSeasons?: number; salary?: number }, acknowledge: (response: AckResponse<{ room: Room; member: ClubStaffMember }>) => void) => void;
  'career:staff:hire': (payload: { code: string; clubId: string; staffId: string; requestId: string; years?: number; wage?: number; signingBonus?: number }, acknowledge: (response: AckResponse<{ room: Room; member: ClubStaffMember; contract: ClubStaffContract }>) => void) => void;
  'career:staff:fire': (payload: { code: string; clubId: string; staffId: string; requestId: string; mutualAgreement?: boolean }, acknowledge: (response: AckResponse<{ room: Room; member: ClubStaffMember; contract: ClubStaffContract }>) => void) => void;
  'career:staff:renew': (payload: { code: string; clubId: string; staffId: string; requestId: string; years?: number; wage?: number; renewalBonus?: number }, acknowledge: (response: AckResponse<{ room: Room; member: ClubStaffMember; contract: ClubStaffContract }>) => void) => void;
  'career:professional:lifecycle': (
    payload: {
      code: string;
      clubId: string;
      professionalType: 'staff';
      professionalId: string;
      requestId: string;
      action: ProfessionalLifecycleAction;
      [key: string]: unknown;
    },
    acknowledge: (response: AckResponse<{ room: Room; member?: ClubStaffMember; lifecycle?: ProfessionalLifecycleRecord }>) => void,
  ) => void;
  'club:news-read': (payload: { code: string; newsIds: string[] }, acknowledge: (response: AckResponse<{ room: Room; readCount: number }>) => void) => void;
}

export type BolaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
