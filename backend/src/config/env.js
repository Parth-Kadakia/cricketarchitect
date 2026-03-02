import dotenv from 'dotenv';

dotenv.config();

function parseBoolean(value, fallback = false) {
  if (value == null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

const defaultStreetCricketKeys = 'JegJC_rXxkT4jwg4JmGYGnvYCGwksD4gxOr9BCvnKNY';

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'development_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/global_t20',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  inactivityCheckIntervalMinutes: Number(process.env.INACTIVITY_CHECK_INTERVAL_MINUTES || 60),
  streetCricketApiBaseUrl: process.env.STREET_CRICKET_API_BASE_URL || 'https://streetcricketballsim.vercel.app',
  streetCricketApiKeys: String(process.env.STREET_CRICKET_API_KEYS || defaultStreetCricketKeys)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  streetCricketBallApiEnabled: parseBoolean(process.env.STREET_CRICKET_BALL_API_ENABLED, true),
  streetCricketFullMatchApiEnabled: parseBoolean(process.env.STREET_CRICKET_FULL_MATCH_API_ENABLED, true),
  streetCricketRequestTimeoutMs: Math.max(350, Number(process.env.STREET_CRICKET_TIMEOUT_MS || 1800)),
  streetCricketUseForBatchSims: parseBoolean(process.env.STREET_CRICKET_USE_FOR_BATCH_SIMS, true),
  streetCricketBatchChunkSize: Math.max(1, Number(process.env.STREET_CRICKET_BATCH_CHUNK_SIZE || 10)),
  streetCricketBatchChunkPauseMs: Math.max(1000, Number(process.env.STREET_CRICKET_BATCH_CHUNK_PAUSE_MS || 60000)),
  cityVerificationEnabled: parseBoolean(process.env.CITY_VERIFICATION_ENABLED, true),
  cityVerificationBaseUrl: process.env.CITY_VERIFICATION_BASE_URL || 'https://nominatim.openstreetmap.org',
  cityVerificationUserAgent: process.env.CITY_VERIFICATION_USER_AGENT || 'CricketArchitect/1.0',
  cityVerificationTimeoutMs: Math.max(800, Number(process.env.CITY_VERIFICATION_TIMEOUT_MS || 4000))
};

export default env;
