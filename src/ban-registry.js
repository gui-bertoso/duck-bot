import { audit, db } from './database.js';

export async function loadBanRegistry(){}
export async function registerBan(data){
  const previous=findActiveBan(data.guildId,data.userId);const record={id:previous?.id??`${Date.now().toString(36)}-${data.userId}`,status:'active',bannedAt:new Date().toISOString(),...data};
  if(previous)db.prepare("UPDATE bans SET reason=?,banned_at=?,data=? WHERE id=?").run(data.reason,record.bannedAt,JSON.stringify(record),record.id);
  else db.prepare('INSERT INTO bans VALUES(?,?,?,?,?,?,?)').run(record.id,data.guildId,data.userId,'active',data.reason,record.bannedAt,JSON.stringify(record));
  audit(data.guildId,'member_banned',data.userId,record);return record;
}
export function activeBans(guildId){return db.prepare("SELECT * FROM bans WHERE guild_id=? AND status='active' ORDER BY banned_at DESC").all(guildId).map(mapBan);}
export function findActiveBan(guildId,userId){const row=db.prepare("SELECT * FROM bans WHERE guild_id=? AND user_id=? AND status='active'").get(guildId,userId);return row?mapBan(row):null;}
export function findLatestBan(guildId,userId){const row=db.prepare('SELECT * FROM bans WHERE guild_id=? AND user_id=? ORDER BY banned_at DESC LIMIT 1').get(guildId,userId);return row?mapBan(row):null;}
export async function registerUnban(guildId,userId,moderatorId,unbanReason){const record=findActiveBan(guildId,userId);if(!record)return null;Object.assign(record,{status:'revoked',unbannedAt:new Date().toISOString(),unbannedBy:moderatorId,unbanReason});db.prepare("UPDATE bans SET status='revoked',data=? WHERE id=?").run(JSON.stringify(record),record.id);audit(guildId,'member_unbanned',userId,record);return record;}
function mapBan(row){return {...JSON.parse(row.data),id:row.id,status:row.status,bannedAt:row.banned_at,reason:row.reason};}
