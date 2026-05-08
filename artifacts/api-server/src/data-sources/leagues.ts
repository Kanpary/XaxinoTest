/**
 * League catalogue with ESPN slugs (free, no API key required).
 * ESPN endpoint: https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard
 *
 * Slugs verified against live ESPN API. EMPTY = slug resolves but no fixtures
 * today; still included because it will yield fixtures on match days.
 */

export interface LeagueDef {
  id: string;
  name: string;
  country: string;
  espnSlug: string;
  active: boolean;
  /** Average goals per match (per team side) for engine calibration. */
  avgGoals: number;
  confederation: string;
}

export const LEAGUES: LeagueDef[] = [
  // ── BRASIL ────────────────────────────────────────────────────────────────
  {
    id: "brasileirao-a",
    name: "Brasileirão Série A",
    country: "Brasil",
    espnSlug: "bra.1",
    active: true,
    avgGoals: 2.4,
    confederation: "CONMEBOL",
  },
  {
    id: "brasileirao-b",
    name: "Brasileirão Série B",
    country: "Brasil",
    espnSlug: "bra.2",
    active: true,
    avgGoals: 2.2,
    confederation: "CONMEBOL",
  },
  {
    id: "brasileirao-c",
    name: "Brasileirão Série C",
    country: "Brasil",
    espnSlug: "bra.3",
    active: true,
    avgGoals: 2.1,
    confederation: "CONMEBOL",
  },
  {
    id: "copa-do-brasil",
    name: "Copa do Brasil",
    country: "Brasil",
    espnSlug: "bra.copa_do_brazil",
    active: true,
    avgGoals: 2.4,
    confederation: "CONMEBOL",
  },

  // ── CONMEBOL ──────────────────────────────────────────────────────────────
  {
    id: "libertadores",
    name: "Copa Libertadores",
    country: "CONMEBOL",
    espnSlug: "conmebol.libertadores",
    active: true,
    avgGoals: 2.3,
    confederation: "CONMEBOL",
  },
  {
    id: "sudamericana",
    name: "Copa Sudamericana",
    country: "CONMEBOL",
    espnSlug: "conmebol.sudamericana",
    active: true,
    avgGoals: 2.4,
    confederation: "CONMEBOL",
  },
  {
    id: "argentina-primera",
    name: "Liga Profesional Argentina",
    country: "Argentina",
    espnSlug: "arg.1",
    active: true,
    avgGoals: 2.3,
    confederation: "CONMEBOL",
  },
  {
    id: "argentina-b",
    name: "Primera Nacional Argentina",
    country: "Argentina",
    espnSlug: "arg.2",
    active: true,
    avgGoals: 2.1,
    confederation: "CONMEBOL",
  },
  {
    id: "colombia-primera",
    name: "Liga BetPlay Dimayor",
    country: "Colômbia",
    espnSlug: "col.1",
    active: true,
    avgGoals: 2.4,
    confederation: "CONMEBOL",
  },
  {
    id: "chile-primera",
    name: "Primera División Chile",
    country: "Chile",
    espnSlug: "chi.1",
    active: true,
    avgGoals: 2.2,
    confederation: "CONMEBOL",
  },
  {
    id: "uruguay-primera",
    name: "Primera División Uruguay",
    country: "Uruguai",
    espnSlug: "uru.1",
    active: true,
    avgGoals: 2.3,
    confederation: "CONMEBOL",
  },
  {
    id: "peru-primera",
    name: "Liga 1 Peru",
    country: "Peru",
    espnSlug: "per.1",
    active: true,
    avgGoals: 2.2,
    confederation: "CONMEBOL",
  },
  {
    id: "ecuador-ligue-pro",
    name: "LigaPro Ecuador",
    country: "Equador",
    espnSlug: "ecu.1",
    active: true,
    avgGoals: 2.4,
    confederation: "CONMEBOL",
  },
  {
    id: "venezuela-primera",
    name: "Liga FUTVE Venezuela",
    country: "Venezuela",
    espnSlug: "ven.1",
    active: true,
    avgGoals: 2.0,
    confederation: "CONMEBOL",
  },
  {
    id: "paraguay-primera",
    name: "División Profesional Paraguay",
    country: "Paraguai",
    espnSlug: "par.1",
    active: true,
    avgGoals: 2.2,
    confederation: "CONMEBOL",
  },
  {
    id: "bolivia-primera",
    name: "División Profesional Bolivia",
    country: "Bolívia",
    espnSlug: "bol.1",
    active: true,
    avgGoals: 2.4,
    confederation: "CONMEBOL",
  },

  // ── UEFA – COMPETIÇÕES CONTINENTAIS ──────────────────────────────────────
  {
    id: "ucl",
    name: "Champions League",
    country: "UEFA",
    espnSlug: "uefa.champions",
    active: true,
    avgGoals: 2.9,
    confederation: "UEFA",
  },
  {
    id: "uel",
    name: "Europa League",
    country: "UEFA",
    espnSlug: "uefa.europa",
    active: true,
    avgGoals: 2.8,
    confederation: "UEFA",
  },
  {
    id: "nations-league",
    name: "Nations League",
    country: "UEFA",
    espnSlug: "uefa.nations",
    active: true,
    avgGoals: 2.6,
    confederation: "UEFA",
  },

  // ── ENGLAND ───────────────────────────────────────────────────────────────
  {
    id: "premier-league",
    name: "Premier League",
    country: "Inglaterra",
    espnSlug: "eng.1",
    active: true,
    avgGoals: 2.85,
    confederation: "UEFA",
  },
  {
    id: "championship",
    name: "Championship",
    country: "Inglaterra",
    espnSlug: "eng.2",
    active: true,
    avgGoals: 2.6,
    confederation: "UEFA",
  },
  {
    id: "league-one",
    name: "League One",
    country: "Inglaterra",
    espnSlug: "eng.3",
    active: true,
    avgGoals: 2.7,
    confederation: "UEFA",
  },
  {
    id: "league-two",
    name: "League Two",
    country: "Inglaterra",
    espnSlug: "eng.4",
    active: true,
    avgGoals: 2.5,
    confederation: "UEFA",
  },
  {
    id: "efl-cup",
    name: "EFL Cup (Carabao Cup)",
    country: "Inglaterra",
    espnSlug: "eng.league_cup",
    active: true,
    avgGoals: 3.0,
    confederation: "UEFA",
  },

  // ── SPAIN ─────────────────────────────────────────────────────────────────
  {
    id: "la-liga",
    name: "La Liga",
    country: "Espanha",
    espnSlug: "esp.1",
    active: true,
    avgGoals: 2.5,
    confederation: "UEFA",
  },
  {
    id: "segunda-division",
    name: "Segunda División",
    country: "Espanha",
    espnSlug: "esp.2",
    active: true,
    avgGoals: 2.3,
    confederation: "UEFA",
  },
  {
    id: "copa-del-rey",
    name: "Copa del Rey",
    country: "Espanha",
    espnSlug: "esp.copa_del_rey",
    active: true,
    avgGoals: 2.8,
    confederation: "UEFA",
  },

  // ── GERMANY ───────────────────────────────────────────────────────────────
  {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Alemanha",
    espnSlug: "ger.1",
    active: true,
    avgGoals: 3.1,
    confederation: "UEFA",
  },
  {
    id: "bundesliga-2",
    name: "2. Bundesliga",
    country: "Alemanha",
    espnSlug: "ger.2",
    active: true,
    avgGoals: 2.8,
    confederation: "UEFA",
  },
  {
    id: "dfb-pokal",
    name: "DFB-Pokal",
    country: "Alemanha",
    espnSlug: "ger.dfb_pokal",
    active: true,
    avgGoals: 3.2,
    confederation: "UEFA",
  },

  // ── ITALY ─────────────────────────────────────────────────────────────────
  {
    id: "serie-a-italia",
    name: "Serie A",
    country: "Itália",
    espnSlug: "ita.1",
    active: true,
    avgGoals: 2.7,
    confederation: "UEFA",
  },
  {
    id: "serie-b-italia",
    name: "Serie B",
    country: "Itália",
    espnSlug: "ita.2",
    active: true,
    avgGoals: 2.4,
    confederation: "UEFA",
  },
  {
    id: "coppa-italia",
    name: "Coppa Italia",
    country: "Itália",
    espnSlug: "ita.coppa_italia",
    active: true,
    avgGoals: 2.9,
    confederation: "UEFA",
  },

  // ── FRANCE ────────────────────────────────────────────────────────────────
  {
    id: "ligue-1",
    name: "Ligue 1",
    country: "França",
    espnSlug: "fra.1",
    active: true,
    avgGoals: 2.7,
    confederation: "UEFA",
  },
  {
    id: "ligue-2",
    name: "Ligue 2",
    country: "França",
    espnSlug: "fra.2",
    active: true,
    avgGoals: 2.4,
    confederation: "UEFA",
  },
  {
    id: "coupe-de-france",
    name: "Coupe de France",
    country: "França",
    espnSlug: "fra.coupe_de_france",
    active: true,
    avgGoals: 3.0,
    confederation: "UEFA",
  },

  // ── PORTUGAL ──────────────────────────────────────────────────────────────
  {
    id: "liga-portugal",
    name: "Primeira Liga",
    country: "Portugal",
    espnSlug: "por.1",
    active: true,
    avgGoals: 2.5,
    confederation: "UEFA",
  },

  // ── NETHERLANDS ───────────────────────────────────────────────────────────
  {
    id: "eredivisie",
    name: "Eredivisie",
    country: "Holanda",
    espnSlug: "ned.1",
    active: true,
    avgGoals: 3.2,
    confederation: "UEFA",
  },
  {
    id: "eerste-divisie",
    name: "Eerste Divisie",
    country: "Holanda",
    espnSlug: "ned.2",
    active: true,
    avgGoals: 3.0,
    confederation: "UEFA",
  },

  // ── BELGIUM ───────────────────────────────────────────────────────────────
  {
    id: "jupiler-pro",
    name: "Jupiler Pro League",
    country: "Bélgica",
    espnSlug: "bel.1",
    active: true,
    avgGoals: 2.8,
    confederation: "UEFA",
  },

  // ── TURKEY ────────────────────────────────────────────────────────────────
  {
    id: "super-lig",
    name: "Süper Lig",
    country: "Turquia",
    espnSlug: "tur.1",
    active: true,
    avgGoals: 2.7,
    confederation: "UEFA",
  },

  // ── RUSSIA ────────────────────────────────────────────────────────────────
  {
    id: "rpl",
    name: "Premier League Russa (RPL)",
    country: "Rússia",
    espnSlug: "rus.1",
    active: true,
    avgGoals: 2.5,
    confederation: "UEFA",
  },

  // ── GREECE ────────────────────────────────────────────────────────────────
  {
    id: "super-league-greece",
    name: "Super League Grécia",
    country: "Grécia",
    espnSlug: "gre.1",
    active: true,
    avgGoals: 2.4,
    confederation: "UEFA",
  },

  // ── SCOTLAND ──────────────────────────────────────────────────────────────
  {
    id: "scottish-premiership",
    name: "Scottish Premiership",
    country: "Escócia",
    espnSlug: "sco.1",
    active: true,
    avgGoals: 2.8,
    confederation: "UEFA",
  },
  {
    id: "scottish-championship",
    name: "Scottish Championship",
    country: "Escócia",
    espnSlug: "sco.2",
    active: true,
    avgGoals: 2.5,
    confederation: "UEFA",
  },

  // ── DENMARK ───────────────────────────────────────────────────────────────
  {
    id: "superligaen",
    name: "Superligaen",
    country: "Dinamarca",
    espnSlug: "den.1",
    active: true,
    avgGoals: 2.9,
    confederation: "UEFA",
  },

  // ── SWEDEN ────────────────────────────────────────────────────────────────
  {
    id: "allsvenskan",
    name: "Allsvenskan",
    country: "Suécia",
    espnSlug: "swe.1",
    active: true,
    avgGoals: 2.8,
    confederation: "UEFA",
  },

  // ── NORWAY ────────────────────────────────────────────────────────────────
  {
    id: "eliteserien",
    name: "Eliteserien",
    country: "Noruega",
    espnSlug: "nor.1",
    active: true,
    avgGoals: 3.0,
    confederation: "UEFA",
  },

  // ── AUSTRIA ───────────────────────────────────────────────────────────────
  {
    id: "bundesliga-austria",
    name: "Österreichische Bundesliga",
    country: "Áustria",
    espnSlug: "aut.1",
    active: true,
    avgGoals: 2.8,
    confederation: "UEFA",
  },

  // ── SWITZERLAND ───────────────────────────────────────────────────────────
  {
    id: "super-league-swiss",
    name: "Super League Suíça",
    country: "Suíça",
    espnSlug: "sui.1",
    active: true,
    avgGoals: 2.7,
    confederation: "UEFA",
  },

  // ── CZECH REPUBLIC ────────────────────────────────────────────────────────
  {
    id: "fortuna-liga",
    name: "Fortuna Liga (República Tcheca)",
    country: "Rep. Tcheca",
    espnSlug: "cze.1",
    active: true,
    avgGoals: 2.6,
    confederation: "UEFA",
  },

  // ── CONCACAF ──────────────────────────────────────────────────────────────
  {
    id: "concacaf-champions",
    name: "CONCACAF Champions Cup",
    country: "CONCACAF",
    espnSlug: "concacaf.champions",
    active: true,
    avgGoals: 2.6,
    confederation: "CONCACAF",
  },
  {
    id: "mls",
    name: "MLS",
    country: "EUA",
    espnSlug: "usa.1",
    active: true,
    avgGoals: 2.9,
    confederation: "CONCACAF",
  },
  {
    id: "us-open-cup",
    name: "US Open Cup",
    country: "EUA",
    espnSlug: "usa.open",
    active: true,
    avgGoals: 3.0,
    confederation: "CONCACAF",
  },
  {
    id: "liga-mx",
    name: "Liga MX",
    country: "México",
    espnSlug: "mex.1",
    active: true,
    avgGoals: 2.6,
    confederation: "CONCACAF",
  },
  {
    id: "ascenso-mx",
    name: "Liga de Expansión MX",
    country: "México",
    espnSlug: "mex.2",
    active: true,
    avgGoals: 2.4,
    confederation: "CONCACAF",
  },

  // ── AFC ───────────────────────────────────────────────────────────────────
  {
    id: "afc-champions",
    name: "AFC Champions League Elite",
    country: "AFC",
    espnSlug: "afc.champions",
    active: true,
    avgGoals: 2.5,
    confederation: "AFC",
  },
  {
    id: "j-league",
    name: "J1 League",
    country: "Japão",
    espnSlug: "jpn.1",
    active: true,
    avgGoals: 2.6,
    confederation: "AFC",
  },
  {
    id: "chinese-super-league",
    name: "Chinese Super League",
    country: "China",
    espnSlug: "chn.1",
    active: true,
    avgGoals: 2.5,
    confederation: "AFC",
  },
  {
    id: "indian-super-league",
    name: "Indian Super League",
    country: "Índia",
    espnSlug: "ind.1",
    active: true,
    avgGoals: 2.4,
    confederation: "AFC",
  },
  {
    id: "a-league",
    name: "A-League Men",
    country: "Austrália",
    espnSlug: "aus.1",
    active: true,
    avgGoals: 2.8,
    confederation: "AFC",
  },

  // ── CAF ───────────────────────────────────────────────────────────────────
  {
    id: "caf-champions",
    name: "CAF Champions League",
    country: "CAF",
    espnSlug: "caf.champions",
    active: true,
    avgGoals: 2.2,
    confederation: "CAF",
  },
  {
    id: "psl",
    name: "Premier Soccer League (África do Sul)",
    country: "África do Sul",
    espnSlug: "rsa.1",
    active: true,
    avgGoals: 2.2,
    confederation: "CAF",
  },

  // ── FIFA ──────────────────────────────────────────────────────────────────
  {
    id: "womens-world-cup",
    name: "Copa do Mundo Feminina (FIFA)",
    country: "FIFA",
    espnSlug: "FIFA.WWC",
    active: true,
    avgGoals: 2.8,
    confederation: "FIFA",
  },
];

export function findLeague(id: string): LeagueDef | undefined {
  return LEAGUES.find((l) => l.id === id);
}

export function getLeaguesByConfederation(conf: string): LeagueDef[] {
  return LEAGUES.filter((l) => l.confederation === conf && l.active);
}
