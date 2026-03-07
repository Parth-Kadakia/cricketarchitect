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
  { name: 'New York', country: 'United States of America', latitude: 40.7128, longitude: -74.006 },
  { name: 'Los Angeles', country: 'United States of America', latitude: 34.0522, longitude: -118.2437 },
  { name: 'Chicago', country: 'United States of America', latitude: 41.8781, longitude: -87.6298 },
  { name: 'Houston', country: 'United States of America', latitude: 29.7604, longitude: -95.3698 },
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

const PROMINENT_CRICKET_CITIES = [
  { name: 'Mumbai', country: 'India', latitude: 19.076, longitude: 72.8777 },
  { name: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.209 },
  { name: 'Bengaluru', country: 'India', latitude: 12.9716, longitude: 77.5946 },
  { name: 'Chennai', country: 'India', latitude: 13.0827, longitude: 80.2707 },
  { name: 'Kolkata', country: 'India', latitude: 22.5726, longitude: 88.3639 },
  { name: 'Hyderabad', country: 'India', latitude: 17.385, longitude: 78.4867 },
  { name: 'Ahmedabad', country: 'India', latitude: 23.0225, longitude: 72.5714 },
  { name: 'Pune', country: 'India', latitude: 18.5204, longitude: 73.8567 },
  { name: 'Karachi', country: 'Pakistan', latitude: 24.8607, longitude: 67.0011 },
  { name: 'Lahore', country: 'Pakistan', latitude: 31.5204, longitude: 74.3587 },
  { name: 'Islamabad', country: 'Pakistan', latitude: 33.6844, longitude: 73.0479 },
  { name: 'Rawalpindi', country: 'Pakistan', latitude: 33.5651, longitude: 73.0169 },
  { name: 'Multan', country: 'Pakistan', latitude: 30.1575, longitude: 71.5249 },
  { name: 'Colombo', country: 'Sri Lanka', latitude: 6.9271, longitude: 79.8612 },
  { name: 'Kandy', country: 'Sri Lanka', latitude: 7.2906, longitude: 80.6337 },
  { name: 'Galle', country: 'Sri Lanka', latitude: 6.0535, longitude: 80.221 },
  { name: 'Dambulla', country: 'Sri Lanka', latitude: 7.8731, longitude: 80.651 },
  { name: 'Sydney', country: 'Australia', latitude: -33.8688, longitude: 151.2093 },
  { name: 'Melbourne', country: 'Australia', latitude: -37.8136, longitude: 144.9631 },
  { name: 'Brisbane', country: 'Australia', latitude: -27.4698, longitude: 153.0251 },
  { name: 'Perth', country: 'Australia', latitude: -31.9505, longitude: 115.8605 },
  { name: 'Adelaide', country: 'Australia', latitude: -34.9285, longitude: 138.6007 },
  { name: 'Dhaka', country: 'Bangladesh', latitude: 23.8103, longitude: 90.4125 },
  { name: 'Chittagong', country: 'Bangladesh', latitude: 22.3569, longitude: 91.7832 },
  { name: 'Sylhet', country: 'Bangladesh', latitude: 24.8949, longitude: 91.8687 },
  { name: 'Khulna', country: 'Bangladesh', latitude: 22.8456, longitude: 89.5403 },
  { name: 'Kabul', country: 'Afghanistan', latitude: 34.5553, longitude: 69.2075 },
  { name: 'Kandahar', country: 'Afghanistan', latitude: 31.6289, longitude: 65.7372 },
  { name: 'Herat', country: 'Afghanistan', latitude: 34.3529, longitude: 62.204 },
  { name: 'Harare', country: 'Zimbabwe', latitude: -17.8252, longitude: 31.0335 },
  { name: 'Bulawayo', country: 'Zimbabwe', latitude: -20.1325, longitude: 28.6265 },
  { name: 'Auckland', country: 'New Zealand', latitude: -36.8485, longitude: 174.7633 },
  { name: 'Wellington', country: 'New Zealand', latitude: -41.2866, longitude: 174.7762 },
  { name: 'Christchurch', country: 'New Zealand', latitude: -43.5321, longitude: 172.6362 },
  { name: 'London', country: 'England', latitude: 51.5074, longitude: -0.1278 },
  { name: 'Manchester', country: 'England', latitude: 53.4808, longitude: -2.2426 },
  { name: 'Birmingham', country: 'England', latitude: 52.4862, longitude: -1.8904 },
  { name: 'Leeds', country: 'England', latitude: 53.8008, longitude: -1.5491 },
  { name: 'Nottingham', country: 'England', latitude: 52.9548, longitude: -1.1581 },
  { name: 'Edinburgh', country: 'Scotland', latitude: 55.9533, longitude: -3.1883 },
  { name: 'Glasgow', country: 'Scotland', latitude: 55.8642, longitude: -4.2518 },
  { name: 'Aberdeen', country: 'Scotland', latitude: 57.1497, longitude: -2.0943 },
  { name: 'Dublin', country: 'Ireland', latitude: 53.3498, longitude: -6.2603 },
  { name: 'Cork', country: 'Ireland', latitude: 51.8985, longitude: -8.4756 },
  { name: 'Limerick', country: 'Ireland', latitude: 52.6638, longitude: -8.6267 },
  { name: 'Amsterdam', country: 'Netherlands', latitude: 52.3676, longitude: 4.9041 },
  { name: 'Rotterdam', country: 'Netherlands', latitude: 51.9244, longitude: 4.4777 },
  { name: 'The Hague', country: 'Netherlands', latitude: 52.0705, longitude: 4.3007 },
  { name: 'Cape Town', country: 'South Africa', latitude: -33.9249, longitude: 18.4241 },
  { name: 'Johannesburg', country: 'South Africa', latitude: -26.2041, longitude: 28.0473 },
  { name: 'Durban', country: 'South Africa', latitude: -29.8587, longitude: 31.0218 },
  { name: 'Pretoria', country: 'South Africa', latitude: -25.7479, longitude: 28.2293 },

  { name: 'New York', country: 'United States of America', latitude: 40.7128, longitude: -74.006 },
  { name: 'Los Angeles', country: 'United States of America', latitude: 34.0522, longitude: -118.2437 },
  { name: 'Chicago', country: 'United States of America', latitude: 41.8781, longitude: -87.6298 },
  { name: 'Houston', country: 'United States of America', latitude: 29.7604, longitude: -95.3698 },
  { name: 'Dallas', country: 'United States of America', latitude: 32.7767, longitude: -96.797 },
  { name: 'Miami', country: 'United States of America', latitude: 25.7617, longitude: -80.1918 },
  { name: 'San Francisco', country: 'United States of America', latitude: 37.7749, longitude: -122.4194 },
  { name: 'Seattle', country: 'United States of America', latitude: 47.6062, longitude: -122.3321 },
  { name: 'Atlanta', country: 'United States of America', latitude: 33.749, longitude: -84.388 },
  { name: 'Washington', country: 'United States of America', latitude: 38.9072, longitude: -77.0369 }
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
  const combined = [...PROMINENT_CRICKET_CITIES, ...cities];
  const deduped = [];
  const seen = new Set();

  for (const city of combined) {
    const key = `${String(city.name || '').trim().toLowerCase()}|${String(city.country || '').trim().toLowerCase()}`;
    if (!city.name || !city.country || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(city);
  }

  for (const city of deduped) {
    await dbClient.query(
      `INSERT INTO cities (name, country, latitude, longitude)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name, country) DO NOTHING`,
      [city.name, city.country, city.latitude, city.longitude]
    );
  }

  return deduped.length;
}

export async function ensureProminentCricketCities(dbClient = pool) {
  for (const city of PROMINENT_CRICKET_CITIES) {
    await dbClient.query(
      `INSERT INTO cities (name, country, latitude, longitude)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name, country) DO NOTHING`,
      [city.name, city.country, city.latitude, city.longitude]
    );
  }

  return PROMINENT_CRICKET_CITIES.length;
}
