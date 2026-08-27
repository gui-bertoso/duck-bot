import { PermissionFlagsBits } from 'discord.js';
import { getSettings } from './database.js';

const recent = new Map();
const levelRules = {
  leve: { messages: 8, repeats: 4, mentions: 8, emojis: 15 },
  normal: { messages: 6, repeats: 3, mentions: 6, emojis: 10 },
  rigido: { messages: 4, repeats: 2, mentions: 4, emojis: 7 },
};

export function inspectMessage(message, environmentDomains = []) {
  const settings = getSettings(message.guild.id);
  if (isExempt(message, settings)) return null;
  const rules = levelRules[settings.automodLevel] ?? levelRules.normal;
  const now = Date.now(); const key = `${message.guild.id}:${message.author.id}`;
  const history = (recent.get(key) ?? []).filter((entry) => now-entry.time<8_000);
  history.push({time:now,content:message.content}); recent.set(key,history);
  if(history.length>=rules.messages)return violation('spam','muitas mensagens em poucos segundos',2);
  if(message.content.length>=4&&history.filter(e=>e.content===message.content).length>=rules.repeats)return violation('spam','mensagem repetida',2);
  if(message.mentions.users.size+message.mentions.roles.size>=rules.mentions)return violation('menções','excesso de menções',2);
  if((message.content.match(/<a?:\w+:\d+>/g)??[]).length>=rules.emojis)return violation('emoji','excesso de emojis',1);
  if(/discord(?:app)?\.com\/invite\/|discord\.gg\//i.test(message.content))return violation('convite','convite de outro servidor',2);
  const domains=[...environmentDomains,...settings.allowedDomains].map(d=>d.toLowerCase());
  for(const raw of message.content.match(/https?:\/\/[^\s<]+/gi)??[]){try{const host=new URL(raw).hostname.toLowerCase().replace(/^www\./,'');if(!domains.some(d=>host===d||host.endsWith(`.${d}`)))return violation('link',`domínio desconhecido: ${host}`,2);}catch{return violation('link','link inválido',2);}}
  return null;
}
export function isExempt(message,settings=getSettings(message.guild.id)){return message.member.permissions.has(PermissionFlagsBits.ManageMessages)||settings.exemptChannelIds.includes(message.channel.id)||message.member.roles.cache.some(r=>settings.exemptRoleIds.includes(r.id));}
function violation(type,reason,severity){return {type,reason,severity};}

