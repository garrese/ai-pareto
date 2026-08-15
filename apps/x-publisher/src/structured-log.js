export function structuredLog(severity, message, fields = {}) {
  const entry = JSON.stringify({ severity, message, ...fields, component: 'x-publisher' });
  if (severity === 'ERROR') console.error(entry);
  else console.log(entry);
}
