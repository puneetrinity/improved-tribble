import type { Express, Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../auth';
import { getUserOrganization } from '../lib/organizationService';
import type { CsrfMiddleware } from '../types/routes';
import { jobBriefEnabled, MAX_REQUEST_BYTES } from './contracts';
import { BriefError, BriefRepository, type BriefScope, scopeParameters } from './repository';
import { approveBrief, readBrief, saveBrief } from './commands';
import { draftBrief } from './draft';

function available(req:Request,res:Response,next:NextFunction) {
  res.set('Cache-Control','private, no-store');res.set('Vary','Cookie');
  if (!jobBriefEnabled()) {res.status(503).json({code:'BRIEF_FEATURE_UNAVAILABLE'});return;}
  if (req.method!=='GET' && Buffer.byteLength(JSON.stringify(req.body??null),'utf8')>MAX_REQUEST_BYTES) {
    res.status(413).json({code:'BRIEF_REQUEST_TOO_LARGE'});return;
  }
  next();
}
async function scope(req:Request):Promise<BriefScope> {
  const raw=req.params.id;
  if (!raw || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new BriefError('BRIEF_NOT_FOUND',404);
  const actorId=req.user!.id;
  const org=await getUserOrganization(actorId);
  if (!org) throw new BriefError('BRIEF_NOT_FOUND',404);
  return {organizationId:org.organization.id,jobId:Number(raw),actorId};
}
function handler(fn:(req:Request,repository:BriefRepository,keys:BriefScope)=>Promise<unknown>,repository:BriefRepository) {
  return async(req:Request,res:Response)=>{
    try {res.json(await fn(req,repository,await scope(req)));}
    catch(error) {
      if(error instanceof BriefError) {res.status(error.status).json({code:error.code});return;}
      if(error instanceof ZodError || error instanceof SyntaxError) {res.status(400).json({code:'BRIEF_INVALID_COMMAND'});return;}
      res.status(503).json({code:'BRIEF_UNAVAILABLE'});
    }
  };
}
export function registerJobBriefRoutes(app:Express,csrf:CsrfMiddleware,repository=new BriefRepository()) {
  app.get('/api/jobs/:id/brief',available,requireAuth,handler((_req,repo,keys)=>readBrief(repo,keys),repository));
  app.post('/api/jobs/:id/brief/draft',available,requireAuth,csrf,handler((req,repo,keys)=>draftBrief(repo,keys,req.body),repository));
  app.patch('/api/jobs/:id/brief',available,requireAuth,csrf,handler((req,repo,keys)=>saveBrief(repo,keys,req.body),repository));
  app.post('/api/jobs/:id/brief/approve',available,requireAuth,csrf,handler((req,repo,keys)=>approveBrief(repo,keys,req.body),repository));
  app.get('/api/jobs/:id/brief/history',available,requireAuth,handler(async(req,repo,keys)=>{
    const raw=req.query.limit??'25';
    if (typeof raw!=='string' || !/^[1-9][0-9]*$/.test(raw) || Number(raw)>50) throw new BriefError('BRIEF_INVALID_PAGE',400);
    const beforeTime=req.query.beforeTime??null; const beforeId=req.query.beforeId??null;
    if ((beforeTime===null)!==(beforeId===null) || (beforeTime!==null && (typeof beforeTime!=='string' || !Number.isFinite(Date.parse(beforeTime)))) ||
      (beforeId!==null && (typeof beforeId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(beforeId)))) throw new BriefError('BRIEF_INVALID_PAGE',400);
    return repo.call('history',[...scopeParameters(keys),beforeTime,beforeId,Number(raw)]);
  },repository));
}
