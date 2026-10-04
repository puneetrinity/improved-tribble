import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';

const enabled=process.env.FLOW_BRIEF_BROWSER_DISPOSABLE==='1';
test.describe('5A built recruiter workflow',()=>{
  test.skip(!enabled,'Requires explicitly seeded loopback stack, never production.');
  test.beforeEach(async({page,baseURL})=>{
    if(!baseURL||new URL(baseURL).hostname!=='127.0.0.1')throw Error('BRIEF_DISPOSABLE_BROWSER_REQUIRED');
    // Ordinary browser preferences avoid unrelated first-visit overlays
    // covering the mobile form. Product auth/data/network paths remain real.
    await page.addInitScript(()=>{
      localStorage.setItem('consent.analytics','declined');
      localStorage.setItem('vantahire_first_visit','true');
    });
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
    expect((await page.request.post('/api/login',{data:{username:'recruiter90001@fixture.invalid',password:'seo-fixture-password'}})).status()).toBe(200);
  });
  test('explicit source, manual rubric, approval and publication remain separate',async({page},info)=>{
    const base=Number(process.env.FLOW_BRIEF_BROWSER_JOB_BASE??90101);
    if(!Number.isInteger(base)||base<90000||base>99000)throw Error('SYNTHETIC_JOB_RANGE_REQUIRED');
    const jobId=base+(info.project.name==='Pixel 5'?1:0);
    const jd='Build reliable Python backend services. Work with PostgreSQL and maintain production software.';
    await page.goto(`/jobs/${jobId}/edit`);
    const panel=page.getByRole('region',{name:'Job brief'});
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button',{name:'Approve brief',exact:true})).toBeDisabled();
    await panel.getByRole('button',{name:'Use original prose'}).click();
    await expect(panel.getByLabel('Current JD')).toHaveValue(jd);
    await panel.getByRole('button',{name:'Save JD',exact:true}).click();
    await expect(panel.getByText('JD saved. You can now draft or write the brief.')).toBeVisible();
    await panel.getByRole('button',{name:'Add criterion',exact:true}).click();
    await panel.getByLabel('Criterion 1 label').fill('Python');
    await panel.getByLabel('Criterion 1 requirement').fill('Python');
    await panel.getByRole('button',{name:'Save brief',exact:true}).click();
    await expect(panel.getByText('Brief saved. Approval is a separate action.')).toBeVisible();
    const read=async()=>{const r=await page.request.get(`/api/jobs/${jobId}/brief`);expect(r.status()).toBe(200);return r.json();};
    expect((await read()).approvedVersionId).toBeNull();
    const before=await page.request.get(`/api/jobs/${jobId}`);expect((await before.json()).isActive).toBe(false);
    await panel.getByRole('button',{name:'Approve brief',exact:true}).click();
    await expect(panel.getByText('Brief approved. This did not publish the job or start sourcing.')).toBeVisible();
    expect((await (await page.request.get(`/api/jobs/${jobId}`)).json()).isActive).toBe(false);
    const approved=await read();expect(approved.approvedVersionId).toBeTruthy();
    // Browser fetch supplies the secure localhost CSRF cookie; Playwright's
    // separate API transport does not reproduce that cookie policy over HTTP.
    const mutate=({path,method,data}:{path:string;method:string;data:unknown})=>page.evaluate(async({path,method,data})=>{
      const token=(await (await fetch('/api/csrf-token',{credentials:'include'})).json()).token;
      const r=await fetch(path,{method,credentials:'include',headers:{'content-type':'application/json','x-csrf-token':token},body:JSON.stringify(data)});
      return {status:r.status,body:await r.json()};
    },{path,method,data});
    const publish=await mutate({path:`/api/jobs/${jobId}/status`,method:'PATCH',data:{isActive:true,requestId:randomUUID(),expectedRevision:Number(approved.revision)}});
    expect(publish.status,JSON.stringify(publish.body)).toBe(200);
    const publicJob=await (await page.request.get(`/api/jobs/${jobId}`)).json();expect(Object.keys(publicJob)).toHaveLength(24);expect(publicJob.description).toBe(jd);expect(publicJob.isActive).toBe(true);
    const html=await page.request.get(`/jobs/${jobId}`,{headers:{'user-agent':'Googlebot'}});expect(await html.text()).toContain(jd);expect(await html.text()).not.toMatch(/eliteSchools|rejectTitleRegex/);
    const source=await mutate({path:`/api/jobs/${jobId}/find-candidates`,method:'POST',data:{}});
    expect(source.status).toBe(503);expect(source.body).toMatchObject({code:'SOURCING_ACTIVATION_PENDING'});
    await page.goto(`/jobs/${jobId}/edit`);await expect(page.getByRole('region',{name:'Job brief'})).toContainText('Approved version retained');
    await page.screenshot({path:info.outputPath('approved-brief.png'),fullPage:true});
  });
  test('candidate, foreign recruiter and admin cannot read or approve the brief',async({page})=>{
    for(const username of ['candidate90002@fixture.invalid','recruiter90007@fixture.invalid','admin90008@fixture.invalid']){
      await page.request.post('/api/logout');
      expect((await page.request.post('/api/login',{data:{username,password:'seo-fixture-password'}})).status()).toBe(200);
      expect((await page.request.get('/api/jobs/90101/brief')).status()).toBe(404);
    }
  });
  test('job posting saves an unapproved prose draft without legacy model extraction',async({page})=>{
    const modelRequests:string[]=[];
    page.on('request',request=>{
      if(/\/api\/.*(?:extract-job|analyze-jd|generate-job|brief\/draft)/.test(request.url()))modelRequests.push(request.url());
    });
    const jd=Array(22).fill('Build reliable Python backend services with PostgreSQL and document production operations.').join(' ');
    await page.goto('/jobs/post');
    await page.getByLabel('Original Job Description').fill(jd);
    await expect(page.getByRole('button',{name:'Analyze JD (AI)',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByLabel('Job Title').fill('Synthetic brief creation');
    await page.getByLabel('Location', {exact:false}).first().fill('Bengaluru');
    await expect(page.getByPlaceholder('Max (e.g., 8)')).toHaveCount(0);
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByRole('button',{name:'Next',exact:true}).click();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/jobs')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Save job draft',exact:true}).click();
    const saved=await response;expect(saved.status(),await saved.text()).toBe(201);
    const job=await saved.json();expect(job).toMatchObject({status:'pending',isActive:false});
    expect(job).not.toHaveProperty('currentJD');expect(job).not.toHaveProperty('currentJDHash');
    const invalidCreate=await page.evaluate(async(data)=>{
      const token=(await (await fetch('/api/csrf-token',{credentials:'include'})).json()).token;
      const response=await fetch('/api/jobs',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-csrf-token':token},body:JSON.stringify({...data,experienceYearsMax:10})});
      return {status:response.status,body:await response.json()};
    },saved.request().postDataJSON());
    expect(invalidCreate).toEqual({status:400,body:{code:'BRIEF_EXPERIENCE_MAXIMUM_REFUSED'}});
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}/edit`));
    await expect(page.getByRole('region',{name:'Job brief'})).toBeVisible();
    const brief=await page.request.get(`/api/jobs/${job.id}/brief`);
    expect(await brief.json()).toMatchObject({currentJD:jd,approvedVersionId:null,latest:null});
    expect(modelRequests).toEqual([]);
  });
});
