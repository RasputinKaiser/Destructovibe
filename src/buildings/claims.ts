/* Package ownership markers. A claim is a `CLAIM` or `CLAIM.<agent>` file in a package folder (one file per agent, so two
   agents claiming different parts never write the same file), with `key: value` lines:
     agent: <name>                 required
     task:  <free text>
     parts: all | <part>, <part>   default all
     since: <ISO timestamp>
   Pure functions only; the scripts do the file IO. See src/buildings/README.md. */

export interface Claim { file: string; agent: string; task: string; parts: 'all' | string[]; since: string }

export const isClaimFile = (name: string): boolean => name === 'CLAIM' || /^CLAIM\.[^.].*$/.test(name);

export function parseClaim(file: string, text: string): Claim {
  const kv: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i > 0) kv[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const list = (kv.parts ?? 'all').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  return { file, agent: kv.agent ?? '', task: kv.task ?? '', parts: list.length === 0 || list.includes('all') ? 'all' : list, since: kv.since ?? '' };
}

export const claimCovers = (c: Claim, part: string): boolean => c.parts === 'all' || c.parts.includes(part);

export const describeClaim = (c: Claim): string =>
  `${c.file}: agent=${c.agent || '(none)'} parts=${c.parts === 'all' ? 'all' : c.parts.join(',')} since=${c.since || '?'}${c.task ? ` task=${c.task}` : ''}`;

/** Why `agent` may not update baselines for `scope` (part ids) given the package's claims, or null when it may. */
export function claimRefusal(claims: Claim[], agent: string | undefined, scope: string[]): string | null {
  if (claims.length === 0) return null;
  if (!agent) return `package is claimed (${claims.map((c) => c.agent || c.file).join(', ')}); pass --agent <name>`;
  for (const p of scope) {
    const other = claims.find((c) => claimCovers(c, p) && c.agent !== agent);
    if (other) return `part ${p} is claimed by '${other.agent || '(no agent)'}' (${other.file})`;
    if (!claims.some((c) => c.agent === agent && claimCovers(c, p))) return `agent '${agent}' holds no claim covering part ${p}`;
  }
  return null;
}
