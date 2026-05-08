/**
 * Open-Meteo: free, no API key, real weather forecasts.
 *   https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&hourly=...
 */

import { logger } from "../lib/logger";

interface OpenMeteoResp {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation?: number[];
    wind_speed_10m?: number[];
    weather_code?: number[];
  };
}

export interface WeatherSnapshot {
  temperatureC: number;
  windKph: number;
  precipitationMm: number;
  condition: string;
}

const WMO: Record<number, string> = {
  0: "Céu limpo",
  1: "Predominantemente claro",
  2: "Parcialmente nublado",
  3: "Nublado",
  45: "Nevoeiro",
  48: "Nevoeiro com geada",
  51: "Garoa leve",
  53: "Garoa moderada",
  55: "Garoa intensa",
  61: "Chuva leve",
  63: "Chuva moderada",
  65: "Chuva forte",
  71: "Neve leve",
  73: "Neve moderada",
  75: "Neve forte",
  80: "Pancadas de chuva",
  81: "Pancadas moderadas",
  82: "Pancadas violentas",
  95: "Trovoada",
  96: "Trovoada com granizo leve",
  99: "Trovoada com granizo forte",
};

const venueCoords: Record<string, { lat: number; lon: number }> = {
  "São Paulo": { lat: -23.55, lon: -46.63 },
  "Rio de Janeiro": { lat: -22.91, lon: -43.17 },
  "Belo Horizonte": { lat: -19.92, lon: -43.93 },
  "Porto Alegre": { lat: -30.03, lon: -51.22 },
  Curitiba: { lat: -25.43, lon: -49.27 },
  Salvador: { lat: -12.97, lon: -38.5 },
  Brasília: { lat: -15.78, lon: -47.93 },
  Fortaleza: { lat: -3.72, lon: -38.54 },
  Recife: { lat: -8.05, lon: -34.9 },
  London: { lat: 51.5, lon: -0.13 },
  Manchester: { lat: 53.48, lon: -2.24 },
  Liverpool: { lat: 53.41, lon: -2.99 },
  Madrid: { lat: 40.42, lon: -3.7 },
  Barcelona: { lat: 41.39, lon: 2.17 },
  Milan: { lat: 45.46, lon: 9.19 },
  Rome: { lat: 41.9, lon: 12.5 },
  Munich: { lat: 48.14, lon: 11.58 },
  Berlin: { lat: 52.52, lon: 13.4 },
  Paris: { lat: 48.86, lon: 2.35 },
  Lisbon: { lat: 38.72, lon: -9.14 },
  Amsterdam: { lat: 52.37, lon: 4.9 },
  Buenos_Aires: { lat: -34.6, lon: -58.38 },
};

function venueToCoords(
  city?: string,
  country?: string,
): { lat: number; lon: number } | null {
  if (city && venueCoords[city]) return venueCoords[city]!;
  if (country) {
    const lower = country.toLowerCase();
    if (lower.includes("brazil") || lower.includes("brasil"))
      return venueCoords["São Paulo"]!;
    if (lower.includes("argentina")) return venueCoords["Buenos_Aires"]!;
    if (lower.includes("england") || lower.includes("united kingdom"))
      return venueCoords["London"]!;
    if (lower.includes("spain") || lower.includes("españa"))
      return venueCoords["Madrid"]!;
    if (lower.includes("italy") || lower.includes("italia"))
      return venueCoords["Rome"]!;
    if (lower.includes("germany") || lower.includes("deutschland"))
      return venueCoords["Berlin"]!;
    if (lower.includes("france")) return venueCoords["Paris"]!;
    if (lower.includes("portugal")) return venueCoords["Lisbon"]!;
    if (lower.includes("netherlands") || lower.includes("holland"))
      return venueCoords["Amsterdam"]!;
  }
  return null;
}

export async function fetchWeather(
  city: string | undefined,
  country: string | undefined,
  kickoffUtc: Date,
): Promise<WeatherSnapshot | null> {
  const coords = venueToCoords(city, country);
  if (!coords) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code&forecast_days=3&timezone=UTC`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoResp;
    const times = data.hourly?.time;
    if (!times || times.length === 0) return null;
    const targetIso = kickoffUtc.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    let idx = times.findIndex((t) => t.startsWith(targetIso));
    if (idx === -1) {
      // pick closest hour
      let best = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < times.length; i++) {
        const diff = Math.abs(+new Date(times[i]!) - +kickoffUtc);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      }
      idx = best;
    }
    const temp = data.hourly?.temperature_2m?.[idx] ?? 0;
    const precip = data.hourly?.precipitation?.[idx] ?? 0;
    const wind = data.hourly?.wind_speed_10m?.[idx] ?? 0;
    const code = data.hourly?.weather_code?.[idx] ?? 0;
    return {
      temperatureC: Math.round(temp * 10) / 10,
      windKph: Math.round(wind * 10) / 10,
      precipitationMm: Math.round(precip * 10) / 10,
      condition: WMO[code] ?? "Indefinido",
    };
  } catch (err) {
    logger.warn({ err }, "Open-Meteo request failed");
    return null;
  }
}
