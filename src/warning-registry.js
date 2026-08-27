import { audit, db, getSettings } from './database.js';

export async function loadWarnings(){expireWarnings();}
export async function addWarning(data){
  expireWarnings(data.guildId); const id=`${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`;
  const created=new Date(); const expires=new Date(created.getTime()+getSettings(data.guildId).warningExpiryDays*86_400_000);
  const warning={id,status:'active',acknowledged:false,createdAt:created.toISOString(),expiresAt:expires.toISOString(),...data};
  db.prepare('INSERT INTO warnings VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,data.guildId,data.userId,'active',data.reason,data.moderatorId??null,data.source??null,0,warning.createdAt,warning.expiresAt,JSON.stringify(warning));
  audit(data.guildId,'warning_created',data.userId,warning);
  return {warning,activeCount:activeWarnings(data.guildId,data.userId).reduce((sum,item)=>sum+(item.severity??1),0)};
}
export function activeWarnings(guildId,userId){expireWarnings(guildId);return db.prepare("SELECT * FROM warnings WHERE guild_id=? AND user_id=? AND status='active' ORDER BY created_at").all(guildId,userId).map(mapWarning);}
export async function acknowledgeWarning(id,userId){const row=db.prepare("SELECT * FROM warnings WHERE id=? AND user_id=? AND status='active'").get(id,userId);if(!row)return null;db.prepare('UPDATE warnings SET acknowledged=1 WHERE id=?').run(id);return {...mapWarning(row),acknowledged:true};}
export async function revokeWarning(guildId,id,moderatorId,reason){const row=db.prepare("SELECT * FROM warnings WHERE guild_id=? AND id=? AND status='active'").get(guildId,id);if(!row)return null;db.prepare("UPDATE warnings SET status='revoked' WHERE id=?").run(id);audit(guildId,'warning_revoked',row.user_id,{id,moderatorId,reason});return {...mapWarning(row),status:'revoked'};}
export function clearExpiredWarnings(guildId){return expireWarnings(guildId);}
function expireWarnings(guildId){const now=new Date().toISOString();const result=guildId?db.prepare("UPDATE warnings SET status='expired' WHERE guild_id=? AND status='active' AND expires_at<=?").run(guildId,now):db.prepare("UPDATE warnings SET status='expired' WHERE status='active' AND expires_at<=?").run(now);return Number(result.changes);}
function mapWarning(row){return {...JSON.parse(row.data),id:row.id,status:row.status,acknowledged:Boolean(row.acknowledged),createdAt:row.created_at,expiresAt:row.expires_at};}
