/** Local browser proof using the real React components and synthetic HTTP responses.
 * No server, production account, upload, provider call or database is involved.
 * Run after npm run build: npx tsx scripts/rehearse-resume-recovery.ts
 * This is UI evidence, not the cross-system publication rehearsal.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from '@/lib/queryClient';
import {AuthContext} from '@/hooks/use-auth';
import {CandidatePortal} from '@/components/candidate-portal/CandidatePortal';
const source='22222222-2222-4222-8222-222222222222', old='33333333-3333-4333-8333-333333333333', next='44444444-4444-4444-8444-444444444444', proposal='55555555-5555-4555-8555-555555555555';
let fresh=false;
window.calls=[];
const profile={schemaVersion:3,draftVersion:2,profileVersion:1,preferenceVersion:1,draft:null,
confirmedProfile:{displayName:'Synthetic Candidate',headline:'Engineer',linkedinUrl:null,currentLocation:null,skills:[],employment:[],education:[],projects:[]},
preferences:null,preferenceDraft:{preferenceDraftRevision:0,sections:{},exclusions:[]},publicationActive:false,effectiveConsentRevision:1,
pendingCommands:[],capabilities:{canRequestResume:true,canEdit:true,canConfirm:true}};
window.fetch=async(input,init={})=>{
 const path=new URL(String(input),location.href).pathname, body=init.body?JSON.parse(init.body):null;
 window.calls.push({path,method:init.method||'GET',body});
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 if(path==='/api/csrf-token')return json({token:'synthetic'});
 if(path==='/api/ai/resume')return json({resumes:[1,2,3].map(id=>({id,label:'Synthetic CV '+id,isDefault:id===3,createdAt:'2026-11-08'}))});
 if(path==='/api/candidate/product/profile')return json(profile);
 if(path==='/api/candidate/product/sources/resume-snapshots')return json({schemaVersion:1,sourceId:source,sourceVersion:1,contentHash:'a'.repeat(64)});
 if(path==='/api/candidate/product/sources/resume'){
  if(body.rereadOfCommandId===old)fresh=true;
  return json({commandId:fresh?next:old,sourceId:source,sourceVersion:1,state:'review_ready',reason:null,proposalId:proposal},202);
 }
 if(path.includes('/proposals/'))return fresh?json({schemaVersion:1,sourceId:source,sourceVersion:1,proposalId:proposal,proposalHash:'b'.repeat(64),reviewNotes:[],facts:[{factId:'66666666-6666-4666-8666-666666666666',kind:'skill',targetRowId:null,value:'TypeScript',evidence:[{quote:'TypeScript'}]}]}):json({code:'profile_temporarily_unavailable'},503);
 if(path==='/api/my-applications')return json([]);
 if(path==='/api/saved-jobs')return json({savedJobs:[]});
 return json({});
};
createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><AuthContext.Provider value={{user:{id:1,role:'candidate',emailVerified:true},logoutMutation:{mutate:()=>{}}}}><CandidatePortal firstName="Synthetic" userId={1} section="profile" onNavigate={()=>{}} discovery="not_ready" matching="not_ready" publicJobs={[]} resumeRouting="spark" profile={null} onSignOut={()=>{}} /></AuthContext.Provider></QueryClientProvider>);
`},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':resolve('client/src'),'@shared':resolve('shared')},
 define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=readdirSync('dist/public/assets').filter(f=>f.endsWith('.css')).map(f=>readFileSync(`dist/public/assets/${f}`,'utf8')).join('\n');
const browser=await chromium.launch({headless:true});
try {
 for(const width of [1280,390]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   if(route.request().url()==='http://127.0.0.1:5179/')await route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'});
   else await route.abort();
  });
  await page.goto('http://127.0.0.1:5179/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByText('Remove a file below before uploading another.',{exact:false}).waitFor();
  assert.match(await page.locator('#resume-library li').first().innerText(),/Synthetic CV 3/);
  await page.getByRole('button',{name:'Update profile',exact:true}).click();
  await page.getByRole('button',{name:'Review suggestions',exact:true}).click();
  await page.getByText("We couldn't load the saved suggestions.",{exact:false}).waitFor();
  await page.getByRole('button',{name:'Read file again',exact:true}).click();
  await page.getByText('TypeScript',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Add to my profile',exact:true}).waitFor();
  const result=await page.evaluate(()=>({calls:(window as any).calls,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(result.calls.filter((c:any)=>c.body?.rereadOfCommandId).length,1);
  assert.equal(result.calls.filter((c:any)=>c.method==='DELETE'||(c.path==='/api/ai/resume'&&c.method==='POST')).length,0);
  assert.equal(result.overflow,false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,result:'PASS',newReadRequests:1,uploads:0,deletions:0,pageErrors:0,horizontalOverflow:false}));
  await context.close();
 }
}finally{await browser.close();}
