import {describe,it,expect,vi} from 'vitest';
import {GLOBAL_BUDGET_ENV,globalBudgetsFromEnv,applyGlobalBudgets} from './budget-config';
const configured=()=>Object.fromEntries(GLOBAL_BUDGET_ENV.map((k,i)=>[k,['10','100','2','20','150','3000'][i]]));
describe('owner-only global environment budgets',()=>{
 it('does not invent configuration when absent',()=>expect(globalBudgetsFromEnv({})).toBeNull());
 it('parses approved caps exactly without floating point',()=>expect(globalBudgetsFromEnv(configured())).toEqual({aiDayMicro:'10000000',aiMonthMicro:'100000000',ocrDayMicro:'2000000',ocrMonthMicro:'20000000',rcDayCredits:'150',rcMonthCredits:'3000'}));
 it.each(['','-1','NaN','Infinity','1e3',' 2','0.0000001'])('refuses invalid money %s',value=>expect(()=>globalBudgetsFromEnv({...configured(),SPARK_OCR_GLOBAL_DAILY_USD:value})).toThrow('configuration_invalid'));
 it('refuses partial configuration',()=>expect(()=>globalBudgetsFromEnv({SPARK_AI_GLOBAL_DAILY_USD:'10'})).toThrow());
 it('refuses fractional credits and day greater than month',()=>{
  expect(()=>globalBudgetsFromEnv({...configured(),SPARK_RC_GLOBAL_DAILY_CREDITS:'1.5'})).toThrow();
  expect(()=>globalBudgetsFromEnv({...configured(),SPARK_OCR_GLOBAL_DAILY_USD:'21'})).toThrow();
 });
 it('permits zero to stop new work',()=>expect(globalBudgetsFromEnv({...configured(),SPARK_AI_GLOBAL_DAILY_USD:'0'})?.aiDayMicro).toBe('0'));
 it('passes one whole configuration to an owner routine, never deletes spend',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});await applyGlobalBudgets({query},globalBudgetsFromEnv(configured())!);
  expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0]![0]).toBe('SELECT public.flow_candidate_source_global_configure($1,$2)');
 });
});
