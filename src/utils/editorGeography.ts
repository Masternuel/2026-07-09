export interface GeographyOption {
  value: string;
  label: string;
}

const ISO_COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO
JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR
MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO
RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV
TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/u);

const BRASFOOT_COUNTRY_CODES = `
AFG AFS ALB ALE AND AGO AIA ATG CUR ARS ALG ARG ARM ARU AUS AUT AZE BAH BHR BAN BAR BEL BLZ BEN BER BIE BOL BOS BOT
BRA BRU BUL BKF BUR BUT CAV CAM CMJ CAN CAT CAZ CHA CHI CHN CPR TML COL CNG CRN CRS COM CSR CRO CUB DIN DJI DOM EGI
ELS EMI EQU ERI ESC ELQ ESV ESP EST ETI EUA FIJ FIN FIL FRA GAB GAM GAN GEO GRA GRE GUA GUN GUI GNB GNE HAI HOL HON
HKG HUN IEM ICA ICO IFA ISA IVB IND IDO ING IRA IRQ IRL IRN ISL ISR ITA MON JAM JAP JOR QUE KOS KUW LAO LES LET LBN
LIB LRI LIE LIT LUX MAC MCD MAD MAL MWI MLD MLI MTA MAR MAU MEX MIA MOC MOL MNC MGL NAM NEP NIC NIR NIG NOR NOZ OMA
PGA PAL PAN PNG PAQ PAR PER POL PRI POR QUI RCA RDG RDO RTC ROM RUA RUS SAM SAN STL SCN STP SVG SEN SLE SER SEY SIN
SIR SOM SRI ESS SUD SUE SUI SUR TAD TAI TTI TAW TAN TGO TON TRT TUN TCM TUR UCR UGA URU UZB VAN VEN VIE ZAM ZIM
ICM MIC IMA IMR NAU PLU KIR SUS TUV IVA MST ITC SME NCA GIB GDA GMA MTI GFR BON SMF SMH
`.trim().split(/\s+/u);

const displayNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });

function fold(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/giu, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');
}

function regionName(code: string) {
  return displayNames.of(code) ?? code;
}

const specialCountryOptions: GeographyOption[] = [
  { value: 'Escócia', label: 'Escócia' },
  { value: 'Inglaterra', label: 'Inglaterra' },
  { value: 'Irlanda do Norte', label: 'Irlanda do Norte' },
  { value: 'País de Gales', label: 'País de Gales' },
];

const countryOptionsByValue = new Map<string, GeographyOption>();
for (const code of ISO_COUNTRY_CODES) {
  const label = regionName(code);
  countryOptionsByValue.set(label, { value: label, label });
}
for (const option of specialCountryOptions) countryOptionsByValue.set(option.value, option);

export const NATIONALITY_OPTIONS = [...countryOptionsByValue.values()].sort((left, right) => (
  left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' })
));

const countryAliases = new Map<string, string>();
for (const code of ISO_COUNTRY_CODES) {
  const label = regionName(code);
  countryAliases.set(fold(code), label);
  countryAliases.set(fold(label), label);
}
for (const option of specialCountryOptions) countryAliases.set(fold(option.label), option.value);

const prefixCandidates = new Map<string, string[]>();
for (const option of NATIONALITY_OPTIONS) {
  const prefix = fold(option.label).replaceAll(' ', '').slice(0, 3);
  prefixCandidates.set(prefix, [...(prefixCandidates.get(prefix) ?? []), option.value]);
}
for (const [prefix, values] of prefixCandidates) {
  if (values.length === 1) countryAliases.set(prefix, values[0]);
}

const brasfootAliases: Record<string, string> = {
  AFG: regionName('AF'), AFS: regionName('ZA'), ALE: regionName('DE'), ARS: regionName('SA'),
  BHR: regionName('BH'), BAN: regionName('BD'), BIE: regionName('BY'), BLZ: regionName('BZ'),
  BKF: regionName('BF'), BOT: regionName('BW'), BRU: regionName('BN'), BUT: regionName('BT'),
  CAV: regionName('CV'), CMJ: regionName('KH'), CHN: regionName('CN'), CPR: regionName('CY'),
  TML: regionName('TL'), CNG: regionName('CG'), CRN: regionName('KP'), CRS: regionName('KR'),
  CSR: regionName('CR'), DJI: regionName('DJ'), ELS: regionName('SV'), EMI: regionName('AE'),
  ESC: 'Escócia', ELQ: regionName('SK'), ESV: regionName('SI'), EUA: regionName('US'),
  FIL: regionName('PH'), GUN: regionName('GY'), IEM: regionName('YE'), ICA: regionName('KY'),
  ICO: regionName('CK'), IFA: regionName('FO'), ISA: regionName('SB'), IVB: regionName('VG'),
  IDO: regionName('ID'), ING: 'Inglaterra', QUE: regionName('KE'), LBN: regionName('LB'),
  LIB: regionName('LY'), LRI: regionName('LR'), MCD: regionName('MK'), MWI: regionName('MW'),
  MLD: regionName('MV'), MTA: regionName('MT'), MAU: regionName('MR'), MIA: regionName('MU'),
  MOC: regionName('MZ'), MOL: regionName('MD'), MNC: regionName('MC'), MGL: regionName('MN'),
  NIR: regionName('NE'), NOZ: regionName('NZ'), PGA: regionName('PG'), PAL: regionName('PS'),
  PAQ: regionName('PK'), PRI: regionName('PR'), QUI: regionName('KG'), RCA: regionName('CF'),
  RDG: regionName('CD'), RDO: regionName('DO'), RTC: regionName('CZ'), RUA: regionName('RW'),
  SCN: regionName('KN'), STP: regionName('ST'), SVG: regionName('VC'), SLE: regionName('SL'),
  SIN: regionName('SG'), ESS: regionName('SZ'), TTI: regionName('PF'), TAW: regionName('TW'),
  TRT: regionName('TT'), TCM: regionName('TM'), UCR: regionName('UA'), VAN: regionName('VU'),
  GIB: regionName('GI'), GFR: regionName('GF'), GDA: regionName('GD'), GMA: regionName('GM'),
  MTI: regionName('MQ'), BON: regionName('BQ'), IVA: regionName('CI'),
};
for (const [alias, label] of Object.entries(brasfootAliases)) countryAliases.set(alias, label);

// Aliases que aparecem na base existente e em cadastros manuais.
countryAliases.set('BRA', regionName('BR'));
countryAliases.set('BRASIL', regionName('BR'));
countryAliases.set('ARG', regionName('AR'));
countryAliases.set('ESP', regionName('ES'));
countryAliases.set('POR', regionName('PT'));
countryAliases.set('URU', regionName('UY'));
countryAliases.set('HOL', regionName('NL'));

function brasfootCode(value: string) {
  const match = value.trim().match(/^(?:PAIS[-_ ]*)?(\d{1,3})$/iu);
  if (!match) return value.trim().toLocaleUpperCase('pt-BR');
  return BRASFOOT_COUNTRY_CODES[Number(match[1])] ?? value.trim();
}

export function normalizeNationality(value: unknown, fallback = 'Brasil') {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!raw) return fallback;
  const code = brasfootCode(raw);
  return countryAliases.get(fold(code)) ?? code;
}

export function nationalityOptionsFor(value: unknown) {
  const current = normalizeNationality(value);
  if (NATIONALITY_OPTIONS.some((option) => option.value === current)) return NATIONALITY_OPTIONS;
  return [
    { value: current, label: /^[A-Z0-9_-]+$/u.test(current) ? `Código importado: ${current}` : current },
    ...NATIONALITY_OPTIONS,
  ];
}

export interface BrazilianStateOption extends GeographyOption {
  name: string;
}

const BRAZILIAN_STATE_DATA = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AM', 'Amazonas'], ['AP', 'Amapá'], ['BA', 'Bahia'],
  ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'],
  ['MG', 'Minas Gerais'], ['MS', 'Mato Grosso do Sul'], ['MT', 'Mato Grosso'], ['PA', 'Pará'],
  ['PB', 'Paraíba'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['PR', 'Paraná'], ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['RS', 'Rio Grande do Sul'],
  ['SC', 'Santa Catarina'], ['SE', 'Sergipe'], ['SP', 'São Paulo'], ['TO', 'Tocantins'],
] as const;

export const BRAZILIAN_STATE_OPTIONS: BrazilianStateOption[] = BRAZILIAN_STATE_DATA.map(([value, name]) => ({
  value,
  name,
  label: `${name} (${value})`,
}));

const stateAliases = new Map<string, string>();
for (const option of BRAZILIAN_STATE_OPTIONS) {
  stateAliases.set(fold(option.value), option.value);
  stateAliases.set(fold(option.name), option.value);
  stateAliases.set(fold(option.label), option.value);
}

export function normalizeBrazilianState(value: unknown) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{1,2}$/u.test(raw)) return BRAZILIAN_STATE_OPTIONS[Number(raw)]?.value ?? raw;
  return stateAliases.get(fold(raw)) ?? raw;
}

export function brazilianStateOptionsFor(value: unknown) {
  const current = normalizeBrazilianState(value);
  if (!current || BRAZILIAN_STATE_OPTIONS.some((option) => option.value === current)) return BRAZILIAN_STATE_OPTIONS;
  return [{ value: current, name: current, label: `Valor importado: ${current}` }, ...BRAZILIAN_STATE_OPTIONS];
}

export function isBrazilianCountry(value: unknown) {
  return normalizeNationality(value, '') === regionName('BR');
}
