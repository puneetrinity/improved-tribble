import type {Express,RequestHandler} from 'express';
import {jobsReadiness,type JobsReadinessDependencies} from './readiness';

export function registerJobsAccessRoutes(app:Express,verified:RequestHandler,
 deps:JobsReadinessDependencies,enabled:()=>boolean,resource:()=>string|undefined){
 app.get('/api/candidate/jobs-access',(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!enabled()){res.status(404).json({code:'not_found'});return;}
  next();
 },verified,async(req,res)=>{
  if(Object.keys(req.query).length||req.headers['transfer-encoding']||
     (req.headers['content-length']&&req.headers['content-length']!=='0')){
   res.status(400).json({code:'invalid_request'});return;
  }
  try{
   const result=await jobsReadiness({userId:req.user!.id,authVersion:req.user!.authVersion},deps);
   if(!result.eligible){res.json({eligible:false,reason:'onboarding_required',setupPath:'/candidate-setup'});return;}
   const configured=resource();if(!configured)throw Error('resource_missing');
   const url=new URL(configured);
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/mcp')throw Error('resource_invalid');
   res.json({eligible:true,reason:'ready',resource:url.href,
    instructions:'Add this MCP URL in your assistant, then sign in with your existing Ealana account. Access is free.'});
  }catch{
   res.status(503).json({eligible:false,reason:'authority_unavailable'});
  }
 });
}
