/** One explicit operator test send inside Railway. No database access or automatic retry. */
import {pathToFileURL} from 'node:url';
import type {BudgetAlert} from '../server/candidate-product/budget-alerts';

function need(value:unknown):asserts value {if(!value)throw Error('release_alert_refused');}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateAlertRuntime(env:NodeJS.ProcessEnv){
 need(env.SPARK_PRIVATE_JOB_APPLY==='send-release-test-alert'&&env.NODE_ENV==='production');
 for(const kind of ['PROJECT','ENVIRONMENT','SERVICE']){
  const expected=env[`SPARK_ALERT_${kind}_ID`];
  need(uuid.test(expected??'')&&env[`RAILWAY_${kind}_ID`]===expected);
 }
 need(!!env.RAILWAY_DEPLOYMENT_ID);
 need(env.FLOW_OPS_ALERT_EMAIL==='puneet@ealana.com');
 need(uuid.test(env.SPARK_RELEASE_ALERT_RUN_ID??''));
 need(env.EMAIL_PROVIDER==='brevo'&&!!env.BREVO_SMTP_PASSWORD&&!!env.SEND_FROM_EMAIL);
 need(!env.NODE_OPTIONS&&env.NODE_TLS_REJECT_UNAUTHORIZED!=='0');
}

type Sender=(alert:BudgetAlert,env:NodeJS.ProcessEnv)=>Promise<boolean>;
export async function runReleaseAlert(env:NodeJS.ProcessEnv=process.env,send?:Sender){
 validateAlertRuntime(env);
 // Import after validation. Production uses the same adapter as the durable budget worker.
 const sender=send??(await import('../server/candidate-product/budget-alerts')).sendBudgetAlert;
 const id=env.SPARK_RELEASE_ALERT_RUN_ID!;
 const accepted=await sender({id,token:id,feature:'ai',metric:'release_test',used:'0',cap:'0'},env);
 need(accepted);
 return 'SPARK_RELEASE_ALERT ACCEPTED'; // Provider acceptance, not inbox-delivery proof.
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.log=console.warn=console.error=console.info=console.debug=()=>{};
 const deadline=setTimeout(()=>{process.stdout.write('SPARK_RELEASE_ALERT UNKNOWN\n');process.exit(1);},60000);
 try{
  need(process.argv.length===3&&process.argv[2]==='send-release-test-alert');
  process.stdout.write(`${await runReleaseAlert()}\n`);
  clearTimeout(deadline);process.exit(0);
 }catch{
  clearTimeout(deadline);process.stdout.write('SPARK_RELEASE_ALERT FAIL_OR_UNKNOWN\n');process.exit(1);
 }
}
