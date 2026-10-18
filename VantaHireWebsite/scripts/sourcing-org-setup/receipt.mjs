import {constants} from 'node:fs';
import {open,rename,unlink} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fail} from './contracts.mjs';

export async function readJson(path){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await f.stat();if(!s.isFile()||s.size>262144||s.mode&0o077)fail('SETUP_PRIVATE_FILE_REQUIRED');return JSON.parse(await f.readFile('utf8'));}finally{await f.close();}
}
export async function writeJson(path,value){
  const tmp=join(dirname(path),'.'+basename(path)+'.'+randomUUID()+'.tmp');
  const f=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}
  try{await rename(tmp,path);const d=await open(dirname(path),constants.O_RDONLY);try{await d.sync();}finally{await d.close();}}
  catch(e){await unlink(tmp).catch(()=>{});throw e;}
}
