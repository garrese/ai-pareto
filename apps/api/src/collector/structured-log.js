export function structuredLog(severity, message, fields = {}) {
  const entry = JSON.stringify({ severity, message, ...fields });
  if (severity === 'ERROR') console.error(entry);
  else console.log(entry);
}
