// Loads built-in and user skills, matches them to the current URL, and prepares
// their instructions for the model. See docs/skills.md for the file format.

/** A skill available to the assistant for the current browser session. */
export interface Skill {
  id: string;
  source: 'builtin' | 'user';
  name: string;
  description: string;
  match: string[]; // URL globs, e.g. 'https://github.com/*'
  instructions?: string; // body of the SKILL.md (automation guidance)
  enabled: boolean;
}

/** A user-created skill stored by the extension. */
export interface StoredUserSkill {
  id: string;
  name: string;
  description: string;
  match: string[];
  instructions?: string;
  enabled: boolean;
}

// Vite bundles each built-in SKILL.md as text.
const builtinRaw = import.meta.glob('../skills/**/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Parses the small frontmatter subset used by skill files.
function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data: Record<string, unknown> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val === '') {
      // Collect the indented list below an empty key.
      const arr: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i++;
        arr.push(lines[i].replace(/^\s*-\s+/, '').trim());
      }
      data[key] = arr;
    } else {
      data[key] = val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
  return { data, body: m[2] };
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value.length) return [value];
  return [];
}

/** Metadata shared by skill matching and the Settings list. */
export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  match: string[];
  instructions?: string;
}

/** Returns the built-in skills bundled with the extension. */
export function getBuiltinSkillMeta(): SkillMeta[] {
  return Object.entries(builtinRaw).map(([path, raw]) => {
    const { data, body } = parseFrontmatter(raw);
    const name = String(data.name ?? path.split('/').slice(-2, -1)[0] ?? path);
    return {
      id: `builtin:${name}`,
      name,
      description: String(data.description ?? ''),
      match: asStringList(data.match),
      instructions: body.trim() || undefined,
    };
  });
}

function loadBuiltinSkills(
  state: Record<string, { enabled?: boolean } | undefined>,
): Skill[] {
  return getBuiltinSkillMeta().map((m) => ({
    ...m,
    source: 'builtin' as const,
    // A missing preference means the bundled skill is enabled.
    enabled: state[m.id]?.enabled !== false,
  }));
}

async function loadUserSkills(): Promise<Skill[]> {
  const { hibroUserSkills } = (await chrome.storage.local.get(
    'hibroUserSkills',
  )) as {
    hibroUserSkills?: StoredUserSkill[];
  };
  return (hibroUserSkills ?? []).map((s) => ({
    ...s,
    source: 'user' as const,
  }));
}

// Converts the supported URL glob into a full-string regular expression.
function globToRegExp(glob: string): RegExp {
  const parts = glob
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('^' + parts.join('.*') + '$');
}

/** Returns whether any URL pattern matches the complete URL. */
export function matchUrl(globs: string[], url: string): boolean {
  if (!url) return false;
  return globs.some((g) => {
    try {
      return globToRegExp(g).test(url);
    } catch {
      return false;
    }
  });
}

/** Returns enabled built-in and user skills for the active page. */
export async function resolveActiveSkills(tabUrl: string): Promise<Skill[]> {
  const { hibroSkillState } = (await chrome.storage.local.get(
    'hibroSkillState',
  )) as {
    hibroSkillState?: Record<string, { enabled?: boolean } | undefined>;
  };
  const state = hibroSkillState ?? {};
  const all = [...loadBuiltinSkills(state), ...(await loadUserSkills())];
  return all
    .filter((s) => s.enabled && matchUrl(s.match, tabUrl))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Builds the skill instructions appended to the model prompt. */
export function buildSkillInstructions(skills: Skill[]): string | undefined {
  if (!skills.length) return undefined;
  const parts = skills.map((s) => {
    const head = `## Skill: ${s.name}`;
    const body = s.instructions?.trim();
    return body ? `${head}\n${body}` : head;
  });
  return [
    'The following site skills are active for the current page. Apply their guidance when acting on the page.',
    '',
    parts.join('\n\n'),
  ].join('\n');
}

/** Builds a short list of active skills for capability questions. */
export function buildSkillSummary(skills: Skill[]): string | undefined {
  if (!skills.length) return undefined;
  const lines = skills
    .map((s) => `- ${s.name}${s.description ? ': ' + s.description : ''}`)
    .join('\n');
  return [
    'Active site skills for this page (knowledge the agent applies when you run a task):',
    lines,
    'If the user asks what skills you have or what you can do here, list these. To use one, the user gives a task.',
  ].join('\n');
}
