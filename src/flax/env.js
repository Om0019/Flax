export function getEnvValue(name, fallback = '') {
  if (
    typeof process !== 'undefined'
    && process
    && process.env
    && Object.prototype.hasOwnProperty.call(process.env, name)
  ) {
    return process.env[name];
  }

  return fallback;
}
