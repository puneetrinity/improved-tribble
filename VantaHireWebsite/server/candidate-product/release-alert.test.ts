import {test,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../simpleEmailService',()=>({getEmailService:async()=>({sendEmail:mocks.send})}));
import {runReleaseAlert} from '../../scripts/spark-release-alert';
const id='12345678-1234-1234-1234-123456789abc';
const env:NodeJS.ProcessEnv={NODE_ENV:'production',SPARK_PRIVATE_JOB_APPLY:'send-release-test-alert',
 SPARK_ALERT_PROJECT_ID:id,RAILWAY_PROJECT_ID:id,SPARK_ALERT_ENVIRONMENT_ID:id,RAILWAY_ENVIRONMENT_ID:id,
 SPARK_ALERT_SERVICE_ID:id,RAILWAY_SERVICE_ID:id,RAILWAY_DEPLOYMENT_ID:'deployment',
 SPARK_RELEASE_ALERT_RUN_ID:id,FLOW_OPS_ALERT_EMAIL:'puneet@ealana.com',EMAIL_PROVIDER:'brevo',
 BREVO_SMTP_PASSWORD:'test-only',SEND_FROM_EMAIL:'sender@example.invalid'};
test('one synthetic alert through the real adapter, without candidate data',async()=>{
 mocks.send.mockClear();mocks.send.mockResolvedValue(true);
 expect(await runReleaseAlert(env)).toBe('SPARK_RELEASE_ALERT ACCEPTED');
 expect(mocks.send).toHaveBeenCalledTimes(1);
 const payload=mocks.send.mock.calls[0]![0];
 expect(payload.to).toBe('puneet@ealana.com');
 expect(payload.text).toContain('Limit: release_test');
 expect(payload.text).toContain('Used/reserved: 0\nCap: 0');
 expect(payload.text).not.toContain('test-only');
});
test('unarmed, wrong destination, wrong Railway binding and test-provider fallback refuse before send',async()=>{
 const send=vi.fn();
 for(const [key,value] of Object.entries({SPARK_PRIVATE_JOB_APPLY:'',FLOW_OPS_ALERT_EMAIL:'other@example.invalid',
  RAILWAY_SERVICE_ID:'different',RAILWAY_PROJECT_ID:'different',RAILWAY_ENVIRONMENT_ID:'different',
  RAILWAY_DEPLOYMENT_ID:'',NODE_ENV:'development',EMAIL_PROVIDER:'',BREVO_SMTP_PASSWORD:'',
  SPARK_RELEASE_ALERT_RUN_ID:'',NODE_TLS_REJECT_UNAUTHORIZED:'0',NODE_OPTIONS:'--inspect'})){
  await expect(runReleaseAlert({...env,[key]:value},send)).rejects.toThrow();
 }
 expect(send).not.toHaveBeenCalled();
});
test('no automatic retry after refusal or uncertain failure',async()=>{
 for(const send of [vi.fn().mockResolvedValue(false),vi.fn().mockRejectedValue(Error('secret'))]){
  await expect(runReleaseAlert(env,send)).rejects.toThrow();expect(send).toHaveBeenCalledTimes(1);
 }
});
