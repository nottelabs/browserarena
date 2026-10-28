import { getRequiredEnvVarsForProvider } from '../../providers/index.js';
export const PROVIDERS = ['browserbase','kernel','browser-use','steel','notte'] as const;
export type AccessProvider = typeof PROVIDERS[number];
export interface CampaignConfig {
  schemaVersion: 1; rounds: number; providers: AccessProvider[];
  viewport: {width:number;height:number}; viewport_mode: 'requested'|'native';
  observation_ms: number; captures_ms: number[]; cooldown_ms: number;
  targets: {id:string;domain:string;url:string;source:string;expected_text?:string|null}[];
}
export function parseConfig(input: unknown): CampaignConfig {
  const c=input as CampaignConfig;
  if(!c || c.schemaVersion!==1 || !Number.isInteger(c.rounds) || c.rounds<1 || c.rounds>100) throw Error('Invalid campaign rounds/version');
  if(!Array.isArray(c.providers)||!c.providers.length||new Set(c.providers).size!==c.providers.length||c.providers.some(p=>!PROVIDERS.includes(p))) throw Error('Invalid providers');
  if(!c.viewport||![c.viewport.width,c.viewport.height].every(n=>Number.isInteger(n)&&n>=200&&n<=4096)||!['requested','native'].includes(c.viewport_mode)) throw Error('Invalid viewport');
  if(!Number.isInteger(c.observation_ms)||c.observation_ms<100||c.observation_ms>120000||!Number.isInteger(c.cooldown_ms)||c.cooldown_ms<0||c.cooldown_ms>60000) throw Error('Invalid timing');
  if(!Array.isArray(c.captures_ms)||!c.captures_ms.length||c.captures_ms.at(-1)!==c.observation_ms||c.captures_ms.some((n,i)=>!Number.isInteger(n)||n<=0||n>(c.observation_ms)||i>0&&n<=c.captures_ms[i-1])) throw Error('Invalid capture schedule');
  if(!Array.isArray(c.targets)||!c.targets.length||new Set(c.targets.map(t=>t.id)).size!==c.targets.length) throw Error('Invalid targets');
  for(const t of c.targets) {
    if(!/^[a-z0-9-]+$/.test(t.id)||!t.domain||!t.source||!(t.expected_text==null||typeof t.expected_text==='string')) throw Error('Invalid target metadata');
    const u=new URL(t.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw Error('Invalid target URL');
  }
  return c;
}
export function planCampaign(c:CampaignConfig) {
 return c.providers.flatMap(provider=>Array.from({length:c.rounds},(_,r)=>c.targets.map((_,i)=>{
 const target=c.targets[(i+r*7)%c.targets.length];return {id:`r${r+1}-${provider}-${target.id}`,provider,round:r+1,target};})).flat());
}
export type VisitTask=ReturnType<typeof planCampaign>[number];
export function missingCredentials(c:CampaignConfig,env=process.env) {return [...new Set(c.providers.flatMap(p=>getRequiredEnvVarsForProvider(p).filter(k=>!env[k])))];}
