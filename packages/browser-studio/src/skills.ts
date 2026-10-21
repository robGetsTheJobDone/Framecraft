import type {BrowserFileSystem} from '@deepbench/browser-filesystem';
export type AgentRole = 'planner' | 'designer' | 'reviewer';
export interface StudioSkill {
  id: string;
  version: string;
  roles: AgentRole[];
  instructions: string;
  files?: Record<string, string>;
}
export const defaultSkills = (): StudioSkill[] => [
  {id: 'composition', version: '1.0.0', roles: ['planner', 'designer'], instructions: 'Read the brief and brand rules. Plan a clear opening, message, and call to action. Respect requested language, duration, and aspect ratio. Use editable text for typography. Preserve existing assets and use the validated timeline tools. Never claim unsupported animation or sound effects exist.'},
  {id: 'image-direction', version: '1.0.0', roles: ['planner', 'designer'], instructions: 'When imagery is needed, write specific coherent visual prompts for each scene. Use the image-generation tool and its returned asset IDs. Keep headline copy as editable text rather than baked into generated images. Do not regenerate successful images without a reason.'},
  {id: 'visual-review', version: '1.0.0', roles: ['reviewer'], instructions: 'Inspect every supplied rendered frame. Assess brief adherence, composition, readable typography, brand consistency, cropping, and scene continuity. Report concrete issues with timestamps. A still frame does not prove motion or audible sound. Score 0–10; flag missing requested behavior as a major issue. Never pass work based solely on designer claims.'},
];
const safe = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== '..';
export function validateSkill(skill: StudioSkill) {
  if (!safe(skill.id) || !safe(skill.version) || !skill.instructions.trim() || !skill.roles.length || skill.roles.some(r => !['planner', 'designer', 'reviewer'].includes(r))) throw new Error('Invalid skill identity, instructions, or roles');
  for (const path of Object.keys(skill.files ?? {})) if (path.startsWith('/') || path.split('/').some(p => !safe(p)) || path === 'SKILL.md') throw new Error('Skill files must have safe relative paths and cannot replace SKILL.md');
}
export async function createSkillRegistry(filesystem: BrowserFileSystem, initial: StudioSkill[]) {
  let skills: StudioSkill[] = [];
  try {skills = JSON.parse(new TextDecoder().decode(await filesystem.readFile('/skills/manifest.json'))); if (!Array.isArray(skills)) throw new Error('Invalid skill manifest'); skills.forEach(validateSkill);}
  catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;}
  let queue = Promise.resolve();
  const install = (skill: StudioSkill, replace: boolean) => {
    validateSkill(skill); const copy = structuredClone(skill);
    const job = queue.then(async () => {
      const existing = skills.find(s => s.id === copy.id);
      if (existing && !replace) throw new Error(`Skill ${copy.id} already installed; use replace`);
      if (existing?.version === copy.version && JSON.stringify(existing) !== JSON.stringify(copy)) throw new Error('Use a new skill version when changing a skill');
      const base = `/skills/${copy.id}/${copy.version}`;
      try {
        const prior = JSON.parse(new TextDecoder().decode(await filesystem.readFile(`${base}/skill.json`)));
        if (JSON.stringify(prior) !== JSON.stringify(copy)) throw new Error('Use a new skill version when changing a skill');
      } catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;}
      const markdown = `---\nname: ${copy.id}\nversion: ${copy.version}\nroles: [${copy.roles.join(', ')}]\n---\n\n${copy.instructions}\n`;
      // A version is immutable: changes require a new version.
      try {const prior = new TextDecoder().decode(await filesystem.readFile(`${base}/SKILL.md`)); if (prior !== markdown) throw new Error('Skill version already exists with different instructions');}
      catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;}
      await filesystem.writeFile(`${base}/skill.json`, JSON.stringify(copy), {createParents: true});
      await filesystem.writeFile(`${base}/SKILL.md`, markdown, {createParents: true});
      for (const [path, content] of Object.entries(copy.files ?? {})) await filesystem.writeFile(`${base}/${path}`, content, {createParents: true});
      const next = [...skills.filter(s => s.id !== copy.id), copy];
      await filesystem.writeFile('/skills/manifest.json', JSON.stringify(next), {createParents: true}); skills = next;
    });
    queue = job.catch(() => {}); return job;
  };
  for (const skill of initial) if (!skills.some(s => s.id === skill.id)) await install(skill, false);
  return {
    list: () => structuredClone(skills),
    add: (skill: StudioSkill) => install(skill, false),
    replace: (id: string, skill: StudioSkill) => {if (id !== skill.id) throw new Error('Replacement skill ID must match'); return install(skill, true);},
  };
}
