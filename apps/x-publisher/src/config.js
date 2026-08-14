const required = (environment, key) => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const positiveInteger = (value, key, fallback) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${key} must be a positive integer`);
  return parsed;
};

export function loadConfig(environment = process.env) {
  return {
    projectId:
      environment.GOOGLE_CLOUD_PROJECT?.trim() || required(environment, 'GCP_PROJECT_ID'),
    port: positiveInteger(environment.PORT, 'PORT', 8080),
    leaseSeconds: positiveInteger(environment.X_DELIVERY_LEASE_SECONDS, 'X_DELIVERY_LEASE_SECONDS', 300),
    publicSiteUrl: environment.PUBLIC_SITE_URL?.trim() || null,
    x: {
      userId: required(environment, 'X_USER_ID'),
      credentials: {
        consumerKey: required(environment, 'X_API_KEY'),
        consumerSecret: required(environment, 'X_API_SECRET'),
        accessToken: required(environment, 'X_ACCESS_TOKEN'),
        accessTokenSecret: required(environment, 'X_ACCESS_TOKEN_SECRET'),
      },
    },
  };
}
