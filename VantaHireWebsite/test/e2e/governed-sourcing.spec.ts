import {readFileSync,writeFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';

const enabled=process.env.FLOW_SOURCING_BROWSER_DISPOSABLE==='1';
test.describe('governed sourcing built browser, real local routes',()=>{
  test.skip(!enabled,'Explicit isolated three-system fixture required.');
  test('shows a named quote without spending, then prevents another run once admitted',async({page,baseURL})=>{
    if(!baseURL||new URL(baseURL).hostname!=='127.0.0.1')throw Error('DISPOSABLE_BROWSER_REQUIRED');
    const path=process.env.FLOW_SOURCING_BROWSER_FIXTURE;
    if(!path?.startsWith('/tmp/ealana-4d-5b-retained-'))throw Error('SYNTHETIC_FIXTURE_REQUIRED');
    const fixture=JSON.parse(readFileSync(path,'utf8')) as {job:number;email:string;phase:'before'|'confirm'|'after';nonempty?:boolean};
    if(!Number.isSafeInteger(fixture.job)||!fixture.email.endsWith('@fixture.invalid'))throw Error('SYNTHETIC_IDENTITY_REQUIRED');
    await page.addInitScript(()=>{localStorage.setItem('consent.analytics','declined');localStorage.setItem('vantahire_first_visit','true');});
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
    expect((await page.request.post('/api/login',{data:{username:fixture.email,password:'fixture-password'}})).status()).toBe(200);
    // Real relational SQL with privacy enabled: a wrong base-table alias used
    // to turn these reads into 500s even while the sourcing button rendered.
    expect((await page.request.get(`/api/jobs/${fixture.job}/sourced-candidates`)).status()).toBe(200);
    expect((await page.request.get(`/api/jobs/${fixture.job}/cold-outreach/history`)).status()).toBe(200);
    const mutations:string[]=[];
    page.on('request',request=>{if(request.method()!=='GET'&&/find-candidates|sourcing\/preview/.test(request.url()))mutations.push(request.url());});
    await page.goto(`/jobs/${fixture.job}/sourcing`);
    if(fixture.phase==='before'||fixture.phase==='confirm'){
      const start=page.getByRole('button',{name:'Find Candidates',exact:true}).first();
      await expect(start).toBeEnabled({timeout:20000});
      await start.click();
      const dialog=page.getByRole('dialog',{name:'Start this job’s sourcing run?'});
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('remaining runs from your allowance');
      await expect(dialog).toContainText('zero results does not return the run');
      await expect(dialog.getByRole('button',{name:'Confirm Find candidates',exact:true})).toBeEnabled();
      if(fixture.phase==='confirm'){
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/api/jobs/${fixture.job}/find-candidates`));
        await dialog.getByRole('button',{name:'Confirm Find candidates',exact:true}).click();
        const admitted=await response;
        expect([200,202],await admitted.text()).toContain(admitted.status());
        // Synthetic disposable command only, used to prove exact-intent replay
        // after worker restart. This file never contains a live credential.
        writeFileSync(path+'.command.json',JSON.stringify(admitted.request().postDataJSON()),{mode:0o600});
      }else await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
      await expect(dialog).toBeHidden();
    }else{
      await expect(page.getByRole('button',{name:'Run already used',exact:true})).toBeDisabled({timeout:20000});
      if(fixture.nonempty){
        await expect(page.getByText('Synthetic Backend Fixture',{exact:true}).first()).toBeVisible();
        await page.getByRole('button',{name:'Pass',exact:true}).first().click();
        await expect(page.getByRole('button',{name:'Clear decision',exact:true}).first()).toBeVisible();
        await page.getByRole('button',{name:'Clear decision',exact:true}).first().click();
        await expect(page.getByRole('button',{name:'Clear decision',exact:true})).toHaveCount(0);
        await expect(page.getByRole('button',{name:'Shortlist',exact:true}).first()).toBeEnabled();
      }
    }
    if(fixture.phase==='confirm')expect(mutations).toHaveLength(1);
    else expect(mutations).toEqual([]);
  });
});
