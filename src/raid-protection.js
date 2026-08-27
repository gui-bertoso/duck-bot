import { getSettings, updateSettings } from './database.js';

const joins=new Map();
export function registerJoin(member){const settings=getSettings(member.guild.id);const now=Date.now();const list=(joins.get(member.guild.id)??[]).filter(time=>now-time<settings.raidWindowSeconds*1000);list.push(now);joins.set(member.guild.id,list);return {raid:list.length>=settings.raidJoinCount,count:list.length,settings};}
export function accountIsNew(member,days){return Date.now()-member.user.createdTimestamp<days*86_400_000;}
export function setLockdown(guildId,enabled){return updateSettings(guildId,{lockdown:enabled});}
