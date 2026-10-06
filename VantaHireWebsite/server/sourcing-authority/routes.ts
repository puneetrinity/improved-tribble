import type {Express,Request,Response,NextFunction} from 'express';
import {ZodError} from 'zod';
import {requireAuth} from '../auth';
import {getUserOrganization} from '../lib/organizationService';
import type {CsrfMiddleware} from '../types/routes';
import type {BriefScope} from '../job-brief/repository';
import {sourcingEnabled,MAX_SOURCING_BODY_BYTES} from './contracts';
import {SourcingRepository,SourcingError} from './repository';
import {quoteSourcing,readSourcingPreview,requestSourcingPreview,handleSourcingMachineCommand} from './commands';
import {verifySignalSourcingJwt} from '../lib/services/jwt-signer';

function available(req:Request,res:Response,next:NextFunction) {
  res.set('Cache-Control','private, no-store');res.set('Vary','Cookie');
  if(!sourcingEnabled()){res.status(503).json({code:'SOURCING_DISABLED'});return;}
  if(req.method!=='GET'&&Buffer.byteLength(JSON.stringify(req.body??null),'utf8')>MAX_SOURCING_BODY_BYTES){
    res.status(413).json({code:'SOURCING_BODY_TOO_LARGE'});return;
  }
  next();
}
async function scope(req:Request):Promise<BriefScope> {
  const id=req.params.id;
  if(!id||! /^[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id)))throw new SourcingError('SOURCING_NOT_FOUND',404);
  const actorId=req.user!.id,org=await getUserOrganization(actorId);
  if(!org)throw new SourcingError('SOURCING_NOT_FOUND',404);
  // The fixed SQL routine rechecks the current seat and job assignment. A
  // session's organization lookup never substitutes for that authorization.
  return {organizationId:org.organization.id,jobId:Number(id),actorId};
}
function handler(repository:SourcingRepository,fn:(repo:SourcingRepository,keys:BriefScope,body:unknown)=>Promise<unknown>) {
  return async(req:Request,res:Response)=>{
    try{res.json(await fn(repository,await scope(req),req.body));}
    catch(error){
      if(error instanceof SourcingError){res.status(error.status).json({code:error.code});return;}
      if(error instanceof ZodError||error instanceof SyntaxError){res.status(400).json({code:'SOURCING_INVALID_COMMAND'});return;}
      res.status(503).json({code:'SOURCING_UNAVAILABLE'});
    }
  };
}
export function registerSourcingAuthorityRoutes(app:Express,csrf:CsrfMiddleware,repository=new SourcingRepository()) {
  app.get('/api/jobs/:id/sourcing/admission',available,requireAuth,handler(repository,quoteSourcing));
  app.get('/api/jobs/:id/sourcing/preview',available,requireAuth,handler(repository,readSourcingPreview));
  app.post('/api/jobs/:id/sourcing/preview',available,requireAuth,csrf,handler(repository,requestSourcingPreview));
  app.post('/api/internal/sourcing/grant',async(req:Request,res:Response)=>{
    res.set('Cache-Control','no-store');
    const header=req.headers.authorization;
    if(!header || !/^Bearer [^\s]+$/.test(header)){res.status(401).json({code:'SOURCING_MACHINE_AUTH_REQUIRED'});return;}
    let claims:Awaited<ReturnType<typeof verifySignalSourcingJwt>>;
    try{claims=await verifySignalSourcingJwt(header.slice(7));}
    catch{res.status(401).json({code:'SOURCING_MACHINE_AUTH_INVALID'});return;}
    try{
      if(Buffer.byteLength(JSON.stringify(req.body??null),'utf8')>MAX_SOURCING_BODY_BYTES){res.status(413).json({code:'SOURCING_BODY_TOO_LARGE'});return;}
      // Pausing new work must not discard evidence of work already started.
      if(!['receipt','no_dispatch'].includes(req.body?.action)&&!sourcingEnabled()){res.status(503).json({code:'SOURCING_DISABLED'});return;}
      res.json(await handleSourcingMachineCommand(repository,claims,req.body));
    }catch(error){
      if(error instanceof SourcingError){res.status(error.status).json({code:error.code});return;}
      if(error instanceof ZodError){res.status(400).json({code:'SOURCING_INVALID_COMMAND'});return;}
      res.status(503).json({code:'SOURCING_UNAVAILABLE'});
    }
  });
}
