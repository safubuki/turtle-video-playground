let diagnosticSequence = 0;

export function createDiagnosticId(prefix: string, now = Date.now()): string {
  diagnosticSequence = (diagnosticSequence + 1) % 100000;
  const timestamp = new Date(now).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${prefix}-${timestamp}-${diagnosticSequence.toString().padStart(5, '0')}`;
}
