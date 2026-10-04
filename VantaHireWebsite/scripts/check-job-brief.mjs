import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const frozenFiles={
  "server/lib/publicJobPagination.ts": "efe8e84ba98201ecdff9d2ade8e42f65b6e25525a6a53ddfb07a862c701f07dc",
  "server/lib/__tests__/publicJobPagination.test.ts": "b8404dc99366e01296f2128fa58482f42756dbca30b75646cec4701244b2755d",
  "server/lib/__tests__/publicJobCollection.pg.test.ts": "b013b4ccd026ba5426636eff04ad94ee7a650a223fe5e26697fe195742d9c1fd",
  "test/e2e/public-site-seo.spec.ts": "2199e03cac83372e3387b672e392c89e6548d86bd699f966f66861de9f172aaa",
  "server/tests/publicSiteSeo.test.ts": "10f27bc85132b1338380eed5c7abf46fe236442e829bad5a5426a8569ba76170",
  "server/seoUtils.ts": "5a3ae83946f386f346043ff02e926aeb65eb5caebdfa4ffcc8ec2e54e6a72ea2",
  "client/src/lib/seoHelpers.ts": "2b71b7a1736fce5affc7cac36ca61ac015f100e9f82acba32f02ae8a75933407",
  "client/src/pages/jobs-page.tsx": "edaa1e14e6a0f578c5d20e098a0db68d9209130f94a57eb55ee882c5a1df3a77",
  "client/src/pages/application-management-page.tsx": "34bcbfd1b81bba4d90e9e32daf86ce915317ff59b81b9939b206d5429451a02d",
  "server/profile.routes.ts": "e777114341fb77bdaac98cc3d661fc5920c4965999472790cd60eb4fd8422aa7",
  "server/applications.routes.ts": "fc0775fd0affef38c3ac487d10a631eb949d96c80d89c8c85938d6cbf671613b",
  "server/organization-candidates/application-intake.ts": "d04e2745b5bb1e5cf7eac59cd723e9c78af50d7f4f64859ecfb4fbf382c90d0f",
  "server/candidate-index/search.ts": "eab5ded0878a5ea9125cc3d732b987c3b05576ffc774410a4f304cb4b6b55146",
  "package-lock.json": "b985825f298cda976afa6f46792d4eab13ceaa19560efc48098168f187337539",
  "server/schema-migrations/catalog.lock.json": "999636b7722cc305b10f71b9a096cc75701400ff49aea91435f839cadf13b90c"
};
export const frozenRegions=[
  {
    "path": "server/storage.ts",
    "start": "  async getJobs(filters: {",
    "end": "  async updateJobStatus(",
    "hash": "a680c96eab967b609c76d73194632c60971f29c008417bb7c37ad8c4e8d49613"
  },
  {
    "path": "server/storage.ts",
    "start": "  async getPublicJobsByRecruiter(recruiterId: number): Promise<Job[]> {",
    "end": "  async getPublicRecruiters():",
    "hash": "71979fbec7875bb8dac1a75e0d87b24db97fb96b6ba695e5faacbb3803bbd163"
  }
];
const hash=value=>createHash('sha256').update(value).digest('hex');
export function verifyFrozen(read=path=>readFileSync(resolve(root,path),'utf8')) {
  for(const [path,pin] of Object.entries(frozenFiles)) if(hash(read(path))!==pin) throw Error('brief_frozen_file:'+path);
  for(const region of frozenRegions) {
    const text=read(region.path),start=text.indexOf(region.start),end=text.indexOf(region.end,start+region.start.length);
    if(start<0||end<=start||hash(text.slice(start,end))!==region.hash) throw Error('brief_frozen_region:'+region.start);
  }
}
export function verifyAuthority(read=path=>readFileSync(resolve(root,path),'utf8')) {
  const requireTokens=(path,tokens)=>{const text=read(path);for(const token of tokens) if(!text.includes(token)) throw Error('brief_authority:'+path+':'+token);return text;};
  const sql=requireTokens('server/schema-migrations/0014_job_brief_authority.sql',[
    'SECURITY DEFINER','SET search_path=pg_catalog,public','FROM PUBLIC','FOR SHARE','FOR UPDATE',
    'BRIEF_REVISION_REQUIRED','BRIEF_APPROVAL_REQUIRED','BRIEF_REQUEST_CONFLICT','BRIEF_DRAFT_LIMIT',
    'job_activity_before_insert','job_activity_before_update','flow_job_brief_immutable',
  ]);
  if((sql.match(/CREATE FUNCTION public\.flow_job_brief_/g)||[]).length!==7) throw Error('brief_routine_inventory');
  requireTokens('server/job-brief/draft.ts',['maxRetries:0','timeout:30_000','AbortSignal.timeout(35_000)',"repository.call('finish'"]);
  requireTokens('server/job-brief/routes.ts',["'Cache-Control','private, no-store'","requireAuth,csrf","BRIEF_FEATURE_UNAVAILABLE"]);
  requireTokens('server/signal.routes.ts',['SOURCING_ACTIVATION_PENDING']);
  requireTokens('server/job-brief/commands.ts',["FOR UPDATE","actor_kind","'system'","interval '14 days'"]);
  requireTokens('server/storage.ts',['JOB_PERMANENT_DELETION_DISABLED']);
}
export function checkJobBrief(){verifyFrozen();verifyAuthority();}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--test')||process.argv.includes('--pg')||process.argv.includes('--client')){
    const {startVitest}=await import('vitest/node');const pg=process.argv.includes('--pg'),client=process.argv.includes('--client');
    const plugins=client?[(await import('@vitejs/plugin-react')).default()]:[];
    const v=await startVitest('test',[],{root,config:false,environment:client?'jsdom':'node',watch:false,
      include:[client?'test/unit/job-brief.test.tsx':pg?'server/job-brief/__tests__/*.pg.test.ts':'server/job-brief/__tests__/*.test.ts'],
      exclude:pg?[]:['**/*.pg.test.ts'],fileParallelism:false,testTimeout:30000,hookTimeout:30000,
      alias:{'@shared':resolve(root,'shared'),'@':resolve(root,'client/src')}},{plugins});
    if(!v)process.exitCode=1;else await v.close();
  }else{checkJobBrief();console.log('job-brief-guard: OK');}
}
