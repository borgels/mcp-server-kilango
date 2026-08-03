/**
 * Coarse, instance-wide write gating. The REAL capability boundary is the Kilango API
 * key's own role/scopes, which Kilango enforces server-side (403 / ADMIN). This flag is
 * defense-in-depth: when writes are disabled, the tool layer blocks every mutating call
 * before it leaves the process.
 */
export function writesEnabled(): boolean {
  // Default enabled: this is operator tooling whose whole purpose is building portals.
  return (process.env.KILANGO_ENABLE_WRITES ?? 'true') !== 'false';
}

export function assertWritesEnabled(operation: string): void {
  if (!writesEnabled()) {
    throw new Error(
      `Writes are disabled on this Kilango MCP instance (KILANGO_ENABLE_WRITES=false); "${operation}" is a write operation.`,
    );
  }
}
