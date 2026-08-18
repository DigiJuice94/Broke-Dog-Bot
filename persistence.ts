import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export function persistentDataDir(){
  return process.env.DOG_BRAIN_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "";
}

export function persistentFile(envKey:string, fallbackName:string){
  const explicit=process.env[envKey];
  if(explicit) return explicit;
  const dir=persistentDataDir();
  return dir ? join(dir,fallbackName) : fallbackName;
}

function ensureParent(file:string){
  const dir=dirname(file);
  if(dir && dir!==".") mkdirSync(dir,{recursive:true});
}

export function migrateLegacyFile(target:string, legacyName:string){
  try{
    if(existsSync(target) || target===legacyName || isAbsolute(legacyName)) return false;
    if(!existsSync(legacyName)) return false;
    ensureParent(target);
    copyFileSync(legacyName,target);
    return true;
  }catch{return false;}
}

export function readJsonRecovered<T>(file:string):T|undefined{
  for(const candidate of [file,`${file}.bak1`,`${file}.bak2`]){
    try{
      if(!existsSync(candidate)) continue;
      return JSON.parse(readFileSync(candidate,"utf8")) as T;
    }catch{}
  }
  return undefined;
}

export function writeJsonAtomic(file:string,value:unknown){
  ensureParent(file);
  const tmp=`${file}.tmp`, bak1=`${file}.bak1`, bak2=`${file}.bak2`;
  writeFileSync(tmp,JSON.stringify(value,null,2),"utf8");
  JSON.parse(readFileSync(tmp,"utf8"));
  try{ if(existsSync(bak1)) copyFileSync(bak1,bak2); }catch{}
  try{ if(existsSync(file)) copyFileSync(file,bak1); }catch{}
  renameSync(tmp,file);
  try{ if(existsSync(tmp)) unlinkSync(tmp); }catch{}
}

export function persistenceMode(){
  const dir=persistentDataDir();
  return dir ? `PERSISTENT (${dir})` : "LOCAL/EPHEMERAL";
}
