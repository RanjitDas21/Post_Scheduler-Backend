export const getAppBaseUrl = () =>
  (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:4000").replace(/\/$/, "");
