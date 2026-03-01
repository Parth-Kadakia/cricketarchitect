import fs from 'node:fs/promises';
import pool from '../config/db.js';

const ZONE_TAB_PATHS = ['/usr/share/zoneinfo/zone.tab', '/usr/share/lib/zoneinfo/tab/zone_sun.tab'];

const FALLBACK_CITIES = [
  { name: 'Mumbai', country: 'India', latitude: 19.076, longitude: 72.8777 },
  { name: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.209 },
  { name: 'Kolkata', country: 'India', latitude: 22.5726, longitude: 88.3639 },
  { name: 'Chennai', country: 'India', latitude: 13.0827, longitude: 80.2707 },
  { name: 'Bengaluru', country: 'India', latitude: 12.9716, longitude: 77.5946 },
  { name: 'Karachi', country: 'Pakistan', latitude: 24.8607, longitude: 67.0011 },
  { name: 'Lahore', country: 'Pakistan', latitude: 31.5204, longitude: 74.3587 },
  { name: 'Islamabad', country: 'Pakistan', latitude: 33.6844, longitude: 73.0479 },
  { name: 'Dhaka', country: 'Bangladesh', latitude: 23.8103, longitude: 90.4125 },
  { name: 'Chittagong', country: 'Bangladesh', latitude: 22.3569, longitude: 91.7832 },
  { name: 'Colombo', country: 'Sri Lanka', latitude: 6.9271, longitude: 79.8612 },
  { name: 'Kandy', country: 'Sri Lanka', latitude: 7.2906, longitude: 80.6337 },
  { name: 'New York', country: 'United States', latitude: 40.7128, longitude: -74.006 },
  { name: 'Los Angeles', country: 'United States', latitude: 34.0522, longitude: -118.2437 },
  { name: 'Chicago', country: 'United States', latitude: 41.8781, longitude: -87.6298 },
  { name: 'Houston', country: 'United States', latitude: 29.7604, longitude: -95.3698 },
  { name: 'London', country: 'United Kingdom', latitude: 51.5074, longitude: -0.1278 },
  { name: 'Manchester', country: 'United Kingdom', latitude: 53.4808, longitude: -2.2426 },
  { name: 'Birmingham', country: 'United Kingdom', latitude: 52.4862, longitude: -1.8904 },
  { name: 'Sydney', country: 'Australia', latitude: -33.8688, longitude: 151.2093 },
  { name: 'Melbourne', country: 'Australia', latitude: -37.8136, longitude: 144.9631 },
  { name: 'Brisbane', country: 'Australia', latitude: -27.4698, longitude: 153.0251 },
  { name: 'Perth', country: 'Australia', latitude: -31.9505, longitude: 115.8605 },
  { name: 'Adelaide', country: 'Australia', latitude: -34.9285, longitude: 138.6007 },
  { name: 'Cape Town', country: 'South Africa', latitude: -33.9249, longitude: 18.4241 },
  { name: 'Johannesburg', country: 'South Africa', latitude: -26.2041, longitude: 28.0473 },
  { name: 'Durban', country: 'South Africa', latitude: -29.8587, longitude: 31.0218 },
  { name: 'Pretoria', country: 'South Africa', latitude: -25.7479, longitude: 28.2293 },
  { name: 'Dubai', country: 'United Arab Emirates', latitude: 25.2048, longitude: 55.2708 },
  { name: 'Abu Dhabi', country: 'United Arab Emirates', latitude: 24.4539, longitude: 54.3773 },
  { name: 'Sharjah', country: 'United Arab Emirates', latitude: 25.3463, longitude: 55.4209 },
  { name: 'Toronto', country: 'Canada', latitude: 43.6532, longitude: -79.3832 },
  { name: 'Vancouver', country: 'Canada', latitude: 49.2827, longitude: -123.1207 },
  { name: 'Montreal', country: 'Canada', latitude: 45.5017, longitude: -73.5673 },
  { name: 'Bridgetown', country: 'Barbados', latitude: 13.0975, longitude: -59.6167 },
  { name: 'Kingston', country: 'Jamaica', latitude: 17.9712, longitude: -76.7936 },
  { name: 'Port of Spain', country: 'Trinidad and Tobago', latitude: 10.6549, longitude: -61.5019 },
  { name: 'Georgetown', country: 'Guyana', latitude: 6.8013, longitude: -58.1551 },
  { name: "St John's", country: 'Antigua and Barbuda', latitude: 17.1274, longitude: -61.8468 },
  { name: 'Paris', country: 'France', latitude: 48.8566, longitude: 2.3522 },
  { name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 },
  { name: 'Madrid', country: 'Spain', latitude: 40.4168, longitude: -3.7038 },
  { name: 'Rome', country: 'Italy', latitude: 41.9028, longitude: 12.4964 },
  { name: 'Amsterdam', country: 'Netherlands', latitude: 52.3676, longitude: 4.9041 },
  { name: 'Singapore', country: 'Singapore', latitude: 1.3521, longitude: 103.8198 },
  { name: 'Nairobi', country: 'Kenya', latitude: -1.2921, longitude: 36.8219 },
  { name: 'Auckland', country: 'New Zealand', latitude: -36.8485, longitude: 174.7633 },
  { name: 'Wellington', country: 'New Zealand', latitude: -41.2866, longitude: 174.7762 },
  { name: 'Christchurch', country: 'New Zealand', latitude: -43.5321, longitude: 172.6362 },
  { name: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503 }
];

const countryNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

function parseSignedCoordinate(segment, degreeDigits) {
  if (!segment || (segment[0] !== '+' && segment[0] !== '-')) {
    return null;
  }

  const sign = segment[0] === '-' ? -1 : 1;
  const digits = segment.slice(1);
  const degree = Number(digits.slice(0, degreeDigits));
  const minute = Number(digits.slice(degreeDigits, degreeDigits + 2));
  const secondPart = digits.slice(degreeDigits + 2);
  const second = secondPart ? Number(secondPart) : 0;

  if (!Number.isFinite(degree) || !Number.isFinite(minute) || !Number.isFinite(second)) {
    return null;
  }

  return sign * (degree + minute / 60 + second / 3600);
}

function parseCoordinates(raw) {
  const match = String(raw || '').match(/^([+-]\d{4,6})([+-]\d{5,7})$/);
  if (!match) {
    return null;
  }

  const latitude = parseSignedCoordinate(match[1], 2);
  const longitude = parseSignedCoordinate(match[2], 3);

  if (latitude == null || longitude == null) {
    return null;
  }

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6))
  };
}

function normalizeCityName(timeZoneId) {
  const parts = String(timeZoneId || '').split('/');
  if (parts.length < 2) {
    return null;
  }

  const cityPart = parts[parts.length - 1];
  if (!cityPart || cityPart.toUpperCase() === 'UTC' || cityPart.toUpperCase() === 'GMT') {
    return null;
  }

  return cityPart.replace(/_/g, ' ').trim();
}

function countryFromCode(code) {
  if (!code) {
    return null;
  }

  try {
    return countryNames?.of(code) || code;
  } catch (error) {
    return code;
  }
}

async function readZoneTab() {
  for (const candidate of ZONE_TAB_PATHS) {
    try {
      return await fs.readFile(candidate, 'utf-8');
    } catch (error) {
      // try next path
    }
  }

  return null;
}

async function loadWorldCitiesFromZoneTab() {
  const content = await readZoneTab();
  if (!content) {
    return FALLBACK_CITIES;
  }

  const dedupe = new Set();
  const cities = [];

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const [countryCode, coordinates, timeZoneId] = trimmed.split('\t');
    const cityName = normalizeCityName(timeZoneId);
    const country = countryFromCode(countryCode);
    const parsedCoordinates = parseCoordinates(coordinates);

    if (!cityName || !country || !parsedCoordinates) {
      continue;
    }

    const key = `${cityName}|${country}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    cities.push({
      name: cityName,
      country,
      latitude: parsedCoordinates.latitude,
      longitude: parsedCoordinates.longitude
    });
  }

  return cities.length ? cities : FALLBACK_CITIES;
}

export async function seedWorldCities(dbClient = pool) {
  const cities = await loadWorldCitiesFromZoneTab();

  for (const city of cities) {
    await dbClient.query(
      `INSERT INTO cities (name, country, latitude, longitude)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name, country) DO NOTHING`,
      [city.name, city.country, city.latitude, city.longitude]
    );
  }

  return cities.length;
}
