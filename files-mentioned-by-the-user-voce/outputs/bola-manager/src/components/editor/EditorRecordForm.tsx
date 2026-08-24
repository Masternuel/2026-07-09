import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import {
  Archive, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, ImagePlus, Link2, Save,
  ShieldAlert, Star, Trash2, Trophy, Upload, X,
} from 'lucide-react';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { ClubMark } from '../shared/ClubMark';
import { ResilientImage } from '../shared/ResilientImage';
import type {
  EditorClub,
  EditorEntity,
  EditorLeague,
  EditorPlayer,
  EditorPlayerAttributes,
  EditorRecord,
  EditorTournament,
  PlayerPosition,
  TournamentTiebreaker,
} from '../../types';
import {
  foregroundForAccent,
  replacePrimaryClubColor,
  resolveClubThemeColors,
} from '../../utils/clubThemeColors';
import { calculatePlayerOverall } from '../../utils/playerRating';
import {
  brazilianStateOptionsFor,
  isBrazilianCountry,
  nationalityOptionsFor,
  normalizeBrazilianState,
  normalizeNationality,
} from '../../utils/editorGeography';

interface EditorRecordFormProps {
  entity: EditorEntity;
  mode: 'empty' | 'create' | 'edit';
  record: EditorRecord | null;
  leagues: EditorLeague[];
  clubs: EditorClub[];
  pending: boolean;
  panelRef?: Ref<HTMLElement>;
  initialClubId?: string;
  lockedClubId?: string;
  headerSlot?: ReactNode;
  tabPanelId?: string;
  tabLabelledBy?: string;
  onSubmit: (record: EditorRecord, mediaFile: File | null, onProgress: (progress: number) => void) => Promise<EditorRecord | null>;
  onRemoveMedia: (record: EditorRecord) => Promise<EditorRecord | null>;
  onCancel: () => void;
  onArchive: (record: EditorRecord) => Promise<void>;
  onDelete: (record: EditorRecord) => void;
}

const defaultAttributes: EditorPlayerAttributes = {
  velocidade: 10, chute: 10, drible: 10, nocao: 10, defesa: 10, passe: 10, peBom: 10, peRuim: 6,
  forca: 10, resistencia: 10, impulsao: 10,
  reflexos: 10, posicionamentoGol: 10, saidaGol: 10, penaltis: 10,
};

const technicalAttributeKeys: Array<keyof EditorPlayerAttributes> = ['chute', 'drible', 'nocao', 'defesa', 'passe', 'peBom', 'peRuim'];
const physicalAttributeKeys: Array<keyof EditorPlayerAttributes> = ['velocidade', 'forca', 'resistencia', 'impulsao'];
const goalkeeperAttributeKeys: Array<keyof EditorPlayerAttributes> = ['reflexos', 'posicionamentoGol', 'saidaGol', 'penaltis'];
const attributeLabels: Record<keyof EditorPlayerAttributes, string> = {
  velocidade: 'Velocidade', chute: 'Chute', drible: 'Drible', nocao: 'Noção', defesa: 'Defesa', passe: 'Passe',
  peBom: 'Pé bom', peRuim: 'Pé ruim', forca: 'Força', resistencia: 'Resistência', impulsao: 'Impulsão',
  reflexos: 'Reflexos', posicionamentoGol: 'Posicionamento', saidaGol: 'Saída do gol', penaltis: 'Pênaltis',
};

const tiebreakerLabels: Record<TournamentTiebreaker, string> = {
  goal_difference: 'Saldo de gols', goals_scored: 'Gols marcados', wins: 'Número de vitórias',
  head_to_head: 'Confronto direto', fair_play: 'Fair play', away_goals: 'Gols fora de casa',
  extra_time: 'Prorrogação', penalties: 'Pênaltis', drawing_lots: 'Sorteio',
};

const allTiebreakers = Object.keys(tiebreakerLabels) as TournamentTiebreaker[];
const acceptedMediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const maximumMediaBytes = 5 * 1024 * 1024;

function emptyRecord(entity: EditorEntity, leagues: EditorLeague[], clubs: EditorClub[], initialClubId?: string): EditorRecord {
  if (entity === 'leagues') return { id: '', name: '', country: 'Brasil', level: 1, division: 'Série A', legs: 'double', active: true };
  if (entity === 'clubs') {
    return {
      id: '', name: '', abbreviation: '', colors: ['#c8ff3d'], darkThemeColor: null, lightThemeColor: null, stadium: '', stadiumCapacity: 0, reputation: 10,
      division: leagues[0]?.division ?? '', country: 'Brasil', state: '', city: '', leagueId: leagues[0]?.id ?? '',
      budget: 0, crestImageUrl: null, crestImagePath: null, active: true,
    };
  }
  if (entity === 'tournaments') {
    return {
      id: '', name: '', format: 'league', teamCount: 2, legs: 'single',
      tiebreakers: ['goal_difference', 'goals_scored', 'head_to_head'], teamIds: [],
      trophyImageUrl: null, trophyImagePath: null, active: true,
    };
  }
  return {
    id: '', clubId: initialClubId ?? clubs[0]?.id ?? '', name: '', position: 'MC', age: 24, nationality: 'Brasil',
    shirtNumber: 8, overall: 10, attributes: { ...defaultAttributes }, isStar: false,
    avatarImageUrl: null, avatarImagePath: null, active: true,
  };
}

function entityName(entity: EditorEntity) {
  if (entity === 'leagues') return 'Liga';
  if (entity === 'clubs') return 'Clube';
  if (entity === 'players') return 'Jogador';
  return 'Torneio';
}

function mediaUrl(entity: EditorEntity, record: EditorRecord) {
  if (entity === 'clubs') return (record as EditorClub).crestImageUrl;
  if (entity === 'players') return (record as EditorPlayer).avatarImageUrl;
  if (entity === 'tournaments') return (record as EditorTournament).trophyImageUrl;
  return null;
}

function RecordBreadcrumb({ entity, draft, leagues, clubs }: {
  entity: EditorEntity; draft: EditorRecord; leagues: EditorLeague[]; clubs: EditorClub[];
}) {
  if (entity === 'tournaments') {
    const tournament = draft as EditorTournament;
    return (
      <nav className="editor-breadcrumb" aria-label="Regulamento do torneio">
        <span className="is-current">Torneio</span><ChevronRight size={13} />
        <span>{tournament.format === 'league' ? 'Pontos corridos' : tournament.format === 'knockout' ? 'Mata-mata' : 'Grupos + mata-mata'}</span><ChevronRight size={13} />
        <span>{tournament.teamIds.length}/{tournament.teamCount} times</span>
      </nav>
    );
  }
  const club = entity === 'players' ? clubs.find((candidate) => candidate.id === (draft as EditorPlayer).clubId) : entity === 'clubs' ? draft as EditorClub : null;
  const league = entity === 'leagues' ? draft as EditorLeague : leagues.find((candidate) => candidate.id === club?.leagueId);
  return (
    <nav className="editor-breadcrumb" aria-label="Vínculo do registro">
      <span className={entity === 'leagues' ? 'is-current' : undefined}>{league?.name || 'Liga não vinculada'}</span><ChevronRight size={13} />
      <span className={entity === 'clubs' ? 'is-current' : undefined}>{club?.name || 'Clube não vinculado'}</span><ChevronRight size={13} />
      <span className={entity === 'players' ? 'is-current' : undefined}>{entity === 'players' ? draft.name || 'Novo jogador' : 'Jogador'}</span>
    </nav>
  );
}

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'editor-field editor-field--wide' : 'editor-field'}><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

function AttributeEditorGroup({ title, hint, keys, values, onChange }: {
  title: string;
  hint: string;
  keys: Array<keyof EditorPlayerAttributes>;
  values: EditorPlayerAttributes;
  onChange: (key: keyof EditorPlayerAttributes, value: number) => void;
}) {
  return (
    <section className="editor-attributes editor-field--wide" aria-label={`Atributos ${title.toLowerCase()}`}>
      <header><span>{title}</span><small>{hint}</small></header>
      <div>{keys.map((attribute) => (
        <label key={attribute}>
          <span>{attributeLabels[attribute]}</span>
          <input type="number" min={1} max={20} value={values[attribute]} required onChange={(event) => onChange(attribute, Number(event.target.value))} />
        </label>
      ))}</div>
    </section>
  );
}

function MediaField({ entity, record, file, previewUrl, progress, error, pending, canRemove, onFile, onClear, onRemove }: {
  entity: Exclude<EditorEntity, 'leagues'>;
  record: EditorRecord;
  file: File | null;
  previewUrl: string | null;
  progress: number | null;
  error: string | null;
  pending: boolean;
  canRemove: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = entity === 'clubs' ? 'Escudo do clube' : entity === 'players' ? 'Foto do jogador' : 'Troféu do torneio';
  const fallback = entity === 'tournaments' ? <Trophy size={26} /> : <ImagePlus size={26} />;
  const currentUrl = previewUrl || mediaUrl(entity, record);
  return (
    <section className="editor-media-field editor-field--wide" aria-labelledby={`editor-media-${entity}`}>
      <header><span id={`editor-media-${entity}`}>MÍDIA / {label.toUpperCase()}</span><small>PNG, JPEG ou WebP · máximo 5 MB</small></header>
      <div className="editor-media-field__body">
        <div className={`editor-media-preview ${currentUrl ? 'has-image' : ''}`}>
          <ResilientImage src={currentUrl} alt={`Prévia: ${label.toLowerCase()} de ${record.name || 'novo registro'}`} fallback={fallback} />
        </div>
        <div className="editor-media-field__controls">
          <p>{file ? <><strong>{file.name}</strong><small>{(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB · será enviada ao salvar</small></> : <><strong>{currentUrl ? 'Imagem associada' : 'Nenhuma imagem selecionada'}</strong><small>Use uma imagem nítida; o recorte se adapta à interface.</small></>}</p>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => { const next = event.target.files?.[0]; if (next) onFile(next); event.currentTarget.value = ''; }}
          />
          <div>
            <Button type="button" size="sm" variant="secondary" icon={<Upload size={14} />} disabled={pending} onClick={() => inputRef.current?.click()}>
              {currentUrl ? 'Substituir imagem' : 'Selecionar imagem'}
            </Button>
            {file && <Button type="button" size="sm" variant="ghost" icon={<X size={14} />} disabled={pending} onClick={onClear}>Remover seleção</Button>}
            {!file && currentUrl && canRemove && <Button type="button" size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={pending} onClick={onRemove}>Remover imagem</Button>}
          </div>
          {progress !== null && <div className="editor-media-progress" aria-live="polite"><span><i style={{ width: `${progress}%` }} /></span><small>Enviando imagem… {progress}%</small></div>}
          {error && <p className="editor-media-error" role="alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}

export function EditorRecordForm({
  entity, mode, record, leagues, clubs, pending, panelRef, initialClubId, lockedClubId, headerSlot, tabPanelId, tabLabelledBy,
  onSubmit, onRemoveMedia, onCancel, onArchive, onDelete,
}: EditorRecordFormProps) {
  const contextualRecord = (nextRecord: EditorRecord | null) => {
    const next = nextRecord ?? emptyRecord(entity, leagues, clubs, initialClubId);
    if (entity === 'clubs') {
      const club = next as EditorClub;
      return {
        ...club,
        colors: Array.isArray(club.colors) && club.colors.length > 0 ? club.colors : ['#c8ff3d'],
        state: isBrazilianCountry(club.country) ? normalizeBrazilianState(club.state) : club.state ?? null,
      };
    }
    if (entity === 'tournaments') {
      const tournament = next as EditorTournament;
      return {
        ...tournament,
        teamIds: Array.isArray(tournament.teamIds) ? tournament.teamIds : [],
        tiebreakers: Array.isArray(tournament.tiebreakers) && tournament.tiebreakers.length > 0
          ? tournament.tiebreakers
          : ['goal_difference', 'goals_scored', 'head_to_head'],
      } as EditorTournament;
    }
    if (entity !== 'players') return next;
    const player = next as EditorPlayer;
    return {
      ...player,
      ...(lockedClubId ? { clubId: lockedClubId } : {}),
      nationality: normalizeNationality(player.nationality),
      attributes: { ...defaultAttributes, ...player.attributes },
    };
  };
  const [draft, setDraft] = useState<EditorRecord>(() => contextualRecord(record));
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const previewUrl = useMemo(() => mediaFile ? URL.createObjectURL(mediaFile) : null, [mediaFile]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    const preserveMedia = Boolean(record && record.id && record.id === draft.id && mediaFile);
    setDraft(contextualRecord(record));
    if (!preserveMedia) setMediaFile(null);
    setMediaError(null); setUploadProgress(null); setFormError(null);
  }, [entity, mode, record, leagues, clubs, initialClubId, lockedClubId]);

  if (mode === 'empty') {
    return (
      <aside className="editor-inspector editor-inspector--empty" ref={panelRef} tabIndex={-1} aria-label="Painel de detalhes do registro">
        <span className="editor-inspector__empty-icon"><Link2 size={22} /></span><p className="eyebrow">PAINEL DE REGISTRO</p>
        <h2>Selecione uma linha</h2><p>Os dados, vínculos e controles de segurança aparecerão aqui.</p>
        <div className="editor-breadcrumb editor-breadcrumb--placeholder"><span>Liga</span><ChevronRight size={13} /><span>Clube</span><ChevronRight size={13} /><span>Jogador</span></div>
      </aside>
    );
  }

  const editing = mode === 'edit';
  const name = entityName(entity);
  const leagueDraft = entity === 'leagues' ? draft as EditorLeague : null;
  const rawClubDraft = entity === 'clubs' ? draft as EditorClub : null;
  const clubDraft = rawClubDraft ? {
    ...rawClubDraft,
    colors: Array.isArray(rawClubDraft.colors) && rawClubDraft.colors.length > 0
      ? rawClubDraft.colors
      : ['#c8ff3d'],
  } : null;
  const playerDraft = entity === 'players' ? draft as EditorPlayer : null;
  const calculatedOverall = playerDraft ? calculatePlayerOverall(playerDraft) : null;
  const nationalityOptions = playerDraft ? nationalityOptionsFor(playerDraft.nationality) : [];
  const stateOptions = clubDraft ? brazilianStateOptionsFor(clubDraft.state) : [];
  const tournamentDraft = entity === 'tournaments' ? draft as EditorTournament : null;
  const tournamentCountMatches = !tournamentDraft || tournamentDraft.teamIds.length === tournamentDraft.teamCount;
  const clubThemeColors = clubDraft ? resolveClubThemeColors({
    color: clubDraft.colors[0],
    darkThemeColor: clubDraft.darkThemeColor,
    lightThemeColor: clubDraft.lightThemeColor,
  }) : null;

  function update(fields: Partial<EditorRecord>) { setDraft((current) => ({ ...current, ...fields } as EditorRecord)); }
  function updateAttribute(attribute: keyof EditorPlayerAttributes, value: number) {
    if (entity !== 'players') return;
    setDraft((current) => ({ ...(current as EditorPlayer), attributes: { ...(current as EditorPlayer).attributes, [attribute]: value } }));
  }
  function selectMedia(file: File) {
    setMediaError(null);
    if (!acceptedMediaTypes.has(file.type)) { setMediaError('Formato não aceito. Use PNG, JPEG ou WebP.'); return; }
    if (file.size > maximumMediaBytes) { setMediaError('A imagem excede o limite de 5 MB.'); return; }
    if (!file.size) { setMediaError('O arquivo selecionado está vazio.'); return; }
    setMediaFile(file);
  }
  function removeCurrentMedia() {
    setMediaError(null);
    void onRemoveMedia(draft).then((saved) => { if (saved) setDraft(saved); }).catch((error: unknown) => {
      setMediaError(error instanceof Error ? error.message : 'Não foi possível remover a imagem.');
    });
  }
  function toggleTeam(teamId: string) {
    if (!tournamentDraft) return;
    const selected = tournamentDraft.teamIds.includes(teamId);
    if (!selected && tournamentDraft.teamIds.length >= tournamentDraft.teamCount) return;
    update({ teamIds: selected ? tournamentDraft.teamIds.filter((id) => id !== teamId) : [...tournamentDraft.teamIds, teamId] });
    setFormError(null);
  }
  function toggleTiebreaker(item: TournamentTiebreaker) {
    if (!tournamentDraft) return;
    const selected = tournamentDraft.tiebreakers.includes(item);
    if (selected && tournamentDraft.tiebreakers.length === 1) return;
    const next = selected ? tournamentDraft.tiebreakers.filter((candidate) => candidate !== item) : [...tournamentDraft.tiebreakers, item];
    update({ tiebreakers: [...next.filter((candidate) => candidate !== 'penalties'), ...next.filter((candidate) => candidate === 'penalties')] });
  }
  function moveTiebreaker(index: number, direction: -1 | 1) {
    if (!tournamentDraft) return;
    const target = index + direction;
    if (target < 0 || target >= tournamentDraft.tiebreakers.length || tournamentDraft.tiebreakers[index] === 'penalties' || tournamentDraft.tiebreakers[target] === 'penalties') return;
    const next = [...tournamentDraft.tiebreakers];
    [next[index], next[target]] = [next[target], next[index]];
    update({ tiebreakers: next });
  }

  return (
    <aside className="editor-inspector" ref={panelRef} tabIndex={-1} aria-label={`Formulário de ${name.toLowerCase()}`}>
      <header className="editor-inspector__header"><div><p className="eyebrow">{editing ? 'EDITANDO REGISTRO' : 'NOVO REGISTRO'}</p><h2>{draft.name || `${name} sem nome`}</h2></div><Badge tone={draft.active ? 'positive' : 'warning'} dot>{draft.active ? 'Ativo' : 'Arquivado'}</Badge></header>
      {headerSlot}
      <RecordBreadcrumb entity={entity} draft={draft} leagues={leagues} clubs={clubs} />

      <form
        className="editor-record-form"
        id={tabPanelId}
        role={tabPanelId ? 'tabpanel' : undefined}
        aria-labelledby={tabLabelledBy}
        tabIndex={tabPanelId ? 0 : undefined}
        onSubmit={(event) => {
        event.preventDefault();
        if (!tournamentCountMatches) { setFormError(`Selecione exatamente ${tournamentDraft?.teamCount} times para este regulamento.`); return; }
        setFormError(null); setMediaError(null); setUploadProgress(mediaFile ? 0 : null);
        void onSubmit(draft, mediaFile, setUploadProgress).then((saved) => {
          if (!saved) return;
          setDraft(saved); setMediaFile(null); setUploadProgress(null);
        }).catch((error: unknown) => {
          setMediaError(error instanceof Error ? error.message : 'A imagem não pôde ser enviada. Tente novamente.');
        }).finally(() => setUploadProgress(null));
      }}>
        <div className="editor-form-grid">
          <Field label="ID" hint={editing ? 'Imutável' : 'Obrigatório'}><input value={draft.id} disabled={editing} required maxLength={128} onChange={(event) => update({ id: event.target.value.trimStart() })} placeholder="ex: BRA-A" /></Field>
          <Field label="Nome" wide><input value={draft.name} required maxLength={100} onChange={(event) => update({ name: event.target.value })} placeholder={`Nome do ${name.toLowerCase()}`} /></Field>

          {leagueDraft && <><Field label="País"><input value={leagueDraft.country} required onChange={(event) => update({ country: event.target.value })} /></Field><Field label="Nível"><input type="number" min={1} max={20} value={leagueDraft.level} required onChange={(event) => update({ level: Number(event.target.value) })} /></Field><Field label="Divisão"><input value={leagueDraft.division} required onChange={(event) => update({ division: event.target.value })} placeholder="Série A" /></Field><Field label="Turnos"><select value={leagueDraft.legs} onChange={(event) => update({ legs: event.target.value as EditorLeague['legs'] })}><option value="double">Turno e returno</option><option value="single">Turno único</option></select></Field></>}

          {clubDraft && <>
            <Field label="Abreviação"><input value={clubDraft.abbreviation} required maxLength={8} onChange={(event) => update({ abbreviation: event.target.value.toUpperCase() })} placeholder="AUR" /></Field>
            <Field label="Liga"><select value={clubDraft.leagueId ?? ''} required onChange={(event) => { const nextLeague = leagues.find((league) => league.id === event.target.value); update({ leagueId: event.target.value, division: nextLeague?.division ?? clubDraft.division }); }}><option value="">Selecione uma liga</option>{leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}</select></Field>
            <Field label="País"><input value={clubDraft.country} required onChange={(event) => update({ country: event.target.value })} /></Field>
            <Field label="Estado"><span className="editor-select-control"><select aria-label="Selecionar estado do clube" value={clubDraft.state ?? ''} onChange={(event) => update({ state: event.target.value || null })}><option value="">Não informado</option>{stateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></Field>
            <Field label="Cidade"><input value={clubDraft.city ?? ''} required onChange={(event) => update({ city: event.target.value })} /></Field><Field label="Divisão"><input value={clubDraft.division} required onChange={(event) => update({ division: event.target.value })} /></Field><Field label="Nome do estádio"><input value={clubDraft.stadium} required maxLength={120} onChange={(event) => update({ stadium: event.target.value })} placeholder="Ex.: Maracanã" /></Field><Field label="Capacidade" hint="0 = a definir"><input type="number" min={0} max={500000} step={1} value={clubDraft.stadiumCapacity} required onChange={(event) => update({ stadiumCapacity: Number(event.target.value) })} /></Field><Field label="Reputação" hint="1–20"><input type="number" min={1} max={20} value={clubDraft.reputation} required onChange={(event) => update({ reputation: Number(event.target.value) })} /></Field><Field label="Orçamento"><input type="number" min={0} step={1000} value={clubDraft.budget} required onChange={(event) => update({ budget: Number(event.target.value) })} /></Field>
            <Field label="Cor primária" wide><span className="editor-color-input"><input type="color" aria-label="Escolher cor primária" value={clubDraft.colors[0] || '#c8ff3d'} onChange={(event) => update({ colors: replacePrimaryClubColor(clubDraft.colors, event.target.value) })} /><input aria-label="Cor primária hexadecimal" value={clubDraft.colors[0] || '#c8ff3d'} pattern="^#[0-9A-Fa-f]{6}$" required onChange={(event) => update({ colors: replacePrimaryClubColor(clubDraft.colors, event.target.value) })} /><ClubMark code={clubDraft.abbreviation || 'CLB'} color={clubDraft.colors[0]} darkThemeColor={clubDraft.darkThemeColor} lightThemeColor={clubDraft.lightThemeColor} imageUrl={previewUrl || clubDraft.crestImageUrl} size="sm" /></span></Field>
            <Field label="Cor no tema escuro" wide><span className="editor-color-input"><input type="color" aria-label="Escolher cor do tema escuro" value={clubThemeColors!.darkThemeColor} onChange={(event) => update({ darkThemeColor: event.target.value })} /><input aria-label="Cor do tema escuro hexadecimal" value={clubDraft.darkThemeColor ?? clubThemeColors!.darkThemeColor} pattern="^#[0-9A-Fa-f]{6}$" required onChange={(event) => update({ darkThemeColor: event.target.value })} /><ClubMark code={clubDraft.abbreviation || 'CLB'} color={clubDraft.colors[0]} darkThemeColor={clubDraft.darkThemeColor ?? clubThemeColors!.darkThemeColor} lightThemeColor={clubDraft.lightThemeColor ?? clubThemeColors!.lightThemeColor} size="sm" /></span></Field>
            <Field label="Cor no tema claro" wide><span className="editor-color-input"><input type="color" aria-label="Escolher cor do tema claro" value={clubThemeColors!.lightThemeColor} onChange={(event) => update({ lightThemeColor: event.target.value })} /><input aria-label="Cor do tema claro hexadecimal" value={clubDraft.lightThemeColor ?? clubThemeColors!.lightThemeColor} pattern="^#[0-9A-Fa-f]{6}$" required onChange={(event) => update({ lightThemeColor: event.target.value })} /><span className="theme-light"><ClubMark code={clubDraft.abbreviation || 'CLB'} color={clubDraft.colors[0]} darkThemeColor={clubDraft.darkThemeColor ?? clubThemeColors!.darkThemeColor} lightThemeColor={clubDraft.lightThemeColor ?? clubThemeColors!.lightThemeColor} size="sm" /></span></span></Field>
            <section className="editor-theme-preview editor-field--wide" aria-label="Prévia das cores do clube">
              {([
                { key: 'dark', label: 'Tema escuro', canvas: '#111214', accent: clubThemeColors!.darkThemeColor },
                { key: 'light', label: 'Tema claro', canvas: '#eceeeb', accent: clubThemeColors!.lightThemeColor },
              ] as const).map((theme) => <article key={theme.key} className={theme.key === 'light' ? 'theme-light' : undefined} style={{ '--preview-canvas': theme.canvas, '--preview-accent': theme.accent, '--preview-on-accent': foregroundForAccent(theme.accent) } as CSSProperties}><small>{theme.label}</small><div><ClubMark code={clubDraft.abbreviation || 'CLB'} color={clubDraft.colors[0]} darkThemeColor={clubThemeColors!.darkThemeColor} lightThemeColor={clubThemeColors!.lightThemeColor} size="sm" /><span><strong>{clubDraft.name || 'Nome do clube'}</strong><em>{clubDraft.abbreviation || 'CLB'}</em></span><b>{theme.accent}</b></div></article>)}
            </section>
            <MediaField entity="clubs" record={clubDraft} file={mediaFile} previewUrl={previewUrl} progress={uploadProgress} error={mediaError} pending={pending} canRemove={editing} onFile={selectMedia} onClear={() => setMediaFile(null)} onRemove={removeCurrentMedia} />
          </>}

          {playerDraft && <>
            <Field label="Clube" hint={lockedClubId ? 'Definido pelo clube aberto' : undefined} wide><select value={playerDraft.clubId} required disabled={Boolean(lockedClubId)} onChange={(event) => update({ clubId: event.target.value })}><option value="">Selecione um clube</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></Field>
            <Field label="Posição"><select value={playerDraft.position} onChange={(event) => update({ position: event.target.value as PlayerPosition })}>{(['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'PE', 'ATA'] as PlayerPosition[]).map((position) => <option key={position}>{position}</option>)}</select></Field>
            <Field label="Idade"><input type="number" min={14} max={60} value={playerDraft.age} required onChange={(event) => update({ age: Number(event.target.value) })} /></Field>
            <Field label="Nacionalidade"><span className="editor-select-control"><select aria-label="Selecionar nacionalidade do jogador" value={playerDraft.nationality} required onChange={(event) => update({ nationality: event.target.value })}>{nationalityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></Field>
            <Field label="Camisa"><input type="number" min={0} max={99} value={playerDraft.shirtNumber} required onChange={(event) => update({ shirtNumber: Number(event.target.value) })} /></Field><Field label="Overall" hint="Calculado pelos atributos e posição" wide><output className="editor-overall-output" aria-live="polite">{calculatedOverall}</output></Field>
            <AttributeEditorGroup title="ATRIBUTOS TÉCNICOS" hint="Escala de 1 a 20" keys={technicalAttributeKeys} values={playerDraft.attributes} onChange={updateAttribute} />
            <AttributeEditorGroup title="ATRIBUTOS FÍSICOS" hint="Aplicados a todas as posições" keys={physicalAttributeKeys} values={playerDraft.attributes} onChange={updateAttribute} />
            {playerDraft.position === 'GOL' && <AttributeEditorGroup title="ATRIBUTOS DE GOLEIRO" hint="Exclusivos da posição GOL" keys={goalkeeperAttributeKeys} values={playerDraft.attributes} onChange={updateAttribute} />}
            <label className="editor-star-toggle editor-field--wide"><input type="checkbox" checked={playerDraft.isStar} onChange={(event) => update({ isStar: event.target.checked })} /><span className="editor-star-toggle__icon" aria-hidden="true"><Star fill="currentColor" /></span><span><strong>Jogador estrela</strong><small>Aumenta a atratividade comercial e concede um pequeno bônus quando está apto a jogar.</small></span><span aria-hidden="true" /></label>
            <MediaField entity="players" record={playerDraft} file={mediaFile} previewUrl={previewUrl} progress={uploadProgress} error={mediaError} pending={pending} canRemove={editing} onFile={selectMedia} onClear={() => setMediaFile(null)} onRemove={removeCurrentMedia} />
          </>}

          {tournamentDraft && <>
            <div className="editor-regulation-title editor-field--wide"><Trophy size={18} /><span><strong>FICHA DE REGULAMENTO</strong><small>Estrutura esportiva e critérios aplicados em ordem.</small></span></div>
            <Field label="Formato"><select value={tournamentDraft.format} onChange={(event) => update({ format: event.target.value as EditorTournament['format'] })}><option value="league">Pontos corridos</option><option value="knockout">Mata-mata</option><option value="groups_knockout">Grupos + mata-mata</option></select></Field>
            <Field label="Número de times"><input type="number" min={2} max={256} value={tournamentDraft.teamCount} required onChange={(event) => { const teamCount = Number(event.target.value); update({ teamCount, teamIds: tournamentDraft.teamIds.slice(0, Math.max(teamCount, 0)) }); setFormError(null); }} /></Field>
            <Field label="Turnos" wide><select value={tournamentDraft.legs} onChange={(event) => { const legs = event.target.value as EditorTournament['legs']; update({ legs, tiebreakers: legs === 'single' ? tournamentDraft.tiebreakers.filter((item) => item !== 'away_goals') : tournamentDraft.tiebreakers }); }}><option value="single">Turno único</option><option value="double">Turno e returno</option></select></Field>
            <fieldset className="editor-tiebreakers editor-field--wide"><legend>CRITÉRIOS DE DESEMPATE <small>Selecione e ordene</small></legend><div>{allTiebreakers.map((item) => { const index = tournamentDraft.tiebreakers.indexOf(item); const checked = index >= 0; const disabled = item === 'away_goals' && tournamentDraft.legs !== 'double'; return <div key={item} className={checked ? 'is-selected' : undefined}><label><input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleTiebreaker(item)} /><span>{tiebreakerLabels[item]}</span></label>{checked && <span><button type="button" aria-label={`Subir ${tiebreakerLabels[item]}`} disabled={index === 0 || item === 'penalties'} onClick={() => moveTiebreaker(index, -1)}><ArrowUp size={13} /></button><button type="button" aria-label={`Descer ${tiebreakerLabels[item]}`} disabled={index === tournamentDraft.tiebreakers.length - 1 || item === 'penalties' || tournamentDraft.tiebreakers[index + 1] === 'penalties'} onClick={() => moveTiebreaker(index, 1)}><ArrowDown size={13} /></button><em>{index + 1}</em></span>}</div>; })}</div></fieldset>
            <fieldset className="editor-team-selector editor-field--wide" aria-describedby="editor-team-count"><legend>TIMES PARTICIPANTES <small>Selecione {tournamentDraft.teamCount}</small></legend><div className="editor-team-selector__count" id="editor-team-count"><span>{tournamentDraft.teamIds.length}</span><i style={{ width: `${Math.min(100, (tournamentDraft.teamIds.length / tournamentDraft.teamCount) * 100)}%` }} /><strong>de {tournamentDraft.teamCount}</strong></div><div className="editor-team-selector__grid">{clubs.filter((club) => club.active).map((club) => { const checked = tournamentDraft.teamIds.includes(club.id); return <label key={club.id} className={checked ? 'is-selected' : undefined}><input type="checkbox" checked={checked} disabled={!checked && tournamentDraft.teamIds.length >= tournamentDraft.teamCount} onChange={() => toggleTeam(club.id)} /><ClubMark code={club.abbreviation || club.id.slice(0, 3)} color={club.colors[0]} darkThemeColor={club.darkThemeColor} lightThemeColor={club.lightThemeColor} imageUrl={club.crestImageUrl} size="sm" /><span><strong>{club.name}</strong><small>{club.division || 'Sem divisão'}</small></span></label>; })}</div>{!clubs.some((club) => club.active) && <p className="editor-team-selector__empty">Cadastre clubes ativos antes de montar o torneio.</p>}</fieldset>
            {!tournamentCountMatches && <p className="editor-validation-message editor-field--wide" role="status">Selecione mais {Math.max(0, tournamentDraft.teamCount - tournamentDraft.teamIds.length)} time(s) para completar o regulamento.</p>}
            <MediaField entity="tournaments" record={tournamentDraft} file={mediaFile} previewUrl={previewUrl} progress={uploadProgress} error={mediaError} pending={pending} canRemove={editing} onFile={selectMedia} onClear={() => setMediaFile(null)} onRemove={removeCurrentMedia} />
          </>}

          {formError && <p className="editor-form-error editor-field--wide" role="alert">{formError}</p>}
          <label className="editor-active-toggle editor-field--wide"><input type="checkbox" checked={draft.active} onChange={(event) => update({ active: event.target.checked })} /><span><strong>Registro ativo</strong><small>Desative para arquivar sem excluir permanentemente.</small></span><span aria-hidden="true" /></label>
        </div>

        {editing && <div className="editor-safety-note"><ShieldAlert size={15} /><span><strong>Alteração na sua base</strong> Este registro pode ser referenciado por outros itens. O servidor protege exclusões com dependências.</span></div>}
        <footer className="editor-record-form__actions">
          {editing && <Button type="button" size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={pending} onClick={() => onDelete(draft)}>Excluir</Button>}
          {editing && draft.active && <Button type="button" size="sm" variant="ghost" icon={<Archive size={14} />} disabled={pending} onClick={() => void onArchive(draft)}>Arquivar</Button>}
          <span className="editor-record-form__spacer" /><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancelar</Button>
          <Button type="submit" size="sm" variant="primary" loading={pending} icon={editing ? <Save size={14} /> : <Check size={14} />}>{editing ? 'Salvar mudanças' : `Criar ${name.toLowerCase()}`}</Button>
        </footer>
      </form>
    </aside>
  );
}
