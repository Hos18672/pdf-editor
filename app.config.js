// Lets CI host the web build under a sub-path (e.g. GitHub Pages: /<repo>/).
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_BASE_PATH;
  if (baseUrl) config.experiments = { ...(config.experiments ?? {}), baseUrl };
  return config;
};
