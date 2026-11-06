import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
const mocks=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../simpleEmailService',()=>({getEmailService:async()=>({sendEmail:mocks.send})}));
import {deliverBudgetAlerts,sendBudgetAlert,type BudgetAlert} from './budget-alerts';
const item=():BudgetAlert=>({id:randomUUID(),token:randomUUID(),feature:'ai',metric:'global_daily_usd',used:'8000000',cap:'10000000'});
it('sends a minimal warning only to a configured operator',async()=>{
 const a=item();mocks.send.mockResolvedValue(true);
 expect(await sendBudgetAlert(a,{})).toBe(false);expect(mocks.send).not.toHaveBeenCalled();
 expect(await sendBudgetAlert(a,{FLOW_OPS_ALERT_EMAIL:'ops@example.invalid'})).toBe(true);
 const payload=mocks.send.mock.calls[0]![0];expect(payload.to).toBe('ops@example.invalid');expect(payload.text).not.toContain(a.token);
 expect(payload.subject).toContain('budget warning');
});
it('failed delivery stays pending and uses the exact leased token',async()=>{
 const a=item();const query=vi.fn().mockResolvedValueOnce({rows:[{result:a}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{result:null}]});
 expect(await deliverBudgetAlerts({query},async()=>{throw Error('uncertain');})).toBe(0);
 expect(query.mock.calls[1]![1]).toEqual([a.id,a.token,false]);
});
it('explicitly identifies AI auto-disable instead of an ordinary 80% warning',async()=>{
 mocks.send.mockClear();mocks.send.mockResolvedValue(true);
 expect(await sendBudgetAlert({...item(),metric:'shutdown_overrun'},{FLOW_OPS_ALERT_EMAIL:'ops@example.invalid'})).toBe(true);
 for(const [payload] of mocks.send.mock.calls){
  expect(payload.subject).toBe('ealana spark: AI auto-disabled after overrun — review required');
  expect(payload.text).toContain('No automatic retry of uncertain paid calls.');
 }
 mocks.send.mockClear();
 await sendBudgetAlert({...item(),metric:'shutdown_review_required'},{FLOW_OPS_ALERT_EMAIL:'ops@example.invalid'});
 expect(mocks.send.mock.calls[0]![0].subject).toBe('ealana spark: AI disabled — review required');
});
it('acknowledges successful delivery without candidate data',async()=>{
 const a=item();const query=vi.fn().mockResolvedValueOnce({rows:[{result:a}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{result:null}]});
 expect(await deliverBudgetAlerts({query},async()=>true)).toBe(1);expect(query.mock.calls[1]![1]).toEqual([a.id,a.token,true]);
});
