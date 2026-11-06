import { z } from 'zod';

export const PROFILE_SCHEMA_VERSION = 2;
export const MAX_PROFILE_BYTES = 256 * 1024;
export const MAX_PREFERENCE_BYTES = 32 * 1024;
export const profileUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const profileRevision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const profileHash = z.string().regex(/^[0-9a-f]{64}$/);
export function scalarString(value:string):boolean {
  for(let i=0;i<value.length;i++) {
    const n=value.charCodeAt(i);
    if(n>=0xd800&&n<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(n>=0xdc00&&n<=0xdfff)return false;
  }
  return true;
}
const text=(maximum:number,minimum=0)=>z.string().refine(scalarString,'invalid_unicode')
  .transform(v=>v.normalize('NFC').trim()).refine(v=>Array.from(v).length>=minimum&&Array.from(v).length<=maximum,'invalid_length');
export const COUNTRY_CODES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));
// Explicit supported compensation currencies; unknown ISO-like strings never pass.
export const CURRENCIES = new Set(('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG').split(' '));
const country=z.string().refine(v=>COUNTRY_CODES.has(v),'unsupported_country');
const currency=z.string().refine(v=>CURRENCIES.has(v),'unsupported_currency');
const place=z.object({city:text(200,1),countryCode:country}).strict();
const location=place.extend({displayCountry:text(200,1)}).strict();
const dateValue=z.object({value:z.string(),precision:z.enum(['year','month','day'])}).strict().refine(({value,precision})=>{
  const patterns={year:/^[0-9]{4}$/,month:/^[0-9]{4}-[0-9]{2}$/,day:/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/};
  if(!patterns[precision].test(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  if(!year)return false;if(precision==='year')return true;
  if(month!<1||month!>12)return false;if(precision==='month')return true;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  return day!>=1&&day!<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month!-1]!;
},'invalid_date');
const rowBase={id:profileUuid,start:dateValue.nullable(),end:dateValue.nullable(),current:z.boolean()};
const validDates=(r:{start:{value:string}|null;end:{value:string}|null;current:boolean})=>{
  if(r.current&&r.end!==null)return false;
  if(!r.start||!r.end)return true;
  return (r.end.value+'-99-99').slice(0,10)>=(r.start.value+'-01-01').slice(0,10);
};
const employment=z.object({...rowBase,employer:text(200,1),title:text(200,1),description:text(10000)}).strict().refine(validDates,'invalid_dates');
const education=z.object({...rowBase,institution:text(200,1),qualification:text(300),description:text(5000)}).strict().refine(validDates,'invalid_dates');
const project=z.object({...rowBase,name:text(200,1),description:text(10000)}).strict().refine(validDates,'invalid_dates');
const unique=(items:string[])=>new Set(items.map(v=>v.toLowerCase().replace(/\s+/gu,' '))).size===items.length;
const rows=<T extends z.ZodTypeAny>(schema:T,max:number)=>z.array(schema).max(max).refine(items=>new Set(items.map((r:{id:string})=>r.id)).size===items.length,'duplicate_row');
const linkedin=z.string().regex(/^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%~-]+\/?$/)
 .transform(v=>v.replace('https://www.linkedin.com/','https://linkedin.com/').replace(/\/$/,''));
// Candidate-owned display only. Exact host; never a server-side fetch or ranking input.
export const candidatePhotoUrlSchema=z.string().max(2048).regex(/^https:\/\/media\.licdn\.com\/[A-Za-z0-9_~.%/?=&+,:;@!$()*-]+$/);
export const manualProfileSchema=z.object({displayName:text(200),headline:text(300),linkedinUrl:linkedin.nullable(),
 photoUrl:candidatePhotoUrlSchema.nullable().optional(),
 currentLocation:location.nullable(),skills:z.array(text(100,1)).max(200).refine(unique,'duplicate_skill'),
 employment:rows(employment,200),education:rows(education,50),projects:rows(project,50)}).strict();
const money=z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/).transform(v=>{
 const [whole,frac='']=v.split('.');return `${whole}.${frac.padEnd(2,'0')}`;
});
const cents=(s:string)=>BigInt(s.replace('.',''));
const target=z.object({mode:z.literal('target'),currency,period:z.enum(['annual','monthly','hourly']),component:z.enum(['base','total','ctc']),
 targetMin:money,targetMax:money,hardMinimum:money.nullable()}).strict().refine(v=>cents(v.targetMin)<=cents(v.targetMax)
 &&(v.hardMinimum===null||cents(v.hardMinimum)<=cents(v.targetMax)),'invalid_compensation_range');
const subset=<T extends [string,...string[]]>(values:T,min=1)=>z.array(z.enum(values)).min(min).max(values.length).refine(v=>new Set(v).size===v.length,'duplicate_choice');
export const preferencesSchema=z.object({
 desiredRoles:z.array(text(200,1)).min(1).max(10).refine(unique,'duplicate_role'),
 preferredSeniority:z.array(text(100,1)).max(8).refine(unique,'duplicate_seniority'),
 workArrangements:subset(['remote','hybrid','onsite']),
 locations:z.discriminatedUnion('mode',[z.object({mode:z.literal('anywhere')}).strict(),z.object({mode:z.literal('specific'),places:z.array(place).min(1).max(20)}).strict()]),
 remoteRegions:z.discriminatedUnion('mode',[z.object({mode:z.literal('worldwide')}).strict(),z.object({mode:z.literal('countries'),countries:z.array(country).min(1).max(249).refine(v=>new Set(v).size===v.length)}).strict()]).nullable(),
 relocation:z.object({mode:z.enum(['yes','no','discuss']),destinations:z.array(place).max(20)}).strict(),
 employmentTypes:subset(['permanent','contract','part_time','internship']),
 availability:z.discriminatedUnion('mode',[z.object({mode:z.literal('unknown')}).strict(),z.object({mode:z.literal('immediate')}).strict(),
  z.object({mode:z.literal('date'),date:z.string().refine(value=>dateValue.safeParse({value,precision:'day'}).success)}).strict(),
  z.object({mode:z.literal('notice_days'),days:z.number().int().min(0).max(730)}).strict()]),
 compensation:z.union([z.object({mode:z.literal('open_to_discussion')}).strict(),target]),
 strengths:z.object({roles:z.enum(['firm','flexible']),location:z.enum(['firm','flexible']),workArrangement:z.enum(['firm','flexible']),employmentType:z.enum(['firm','flexible']),compensation:z.enum(['firm','flexible'])}).strict(),
}).strict().refine(v=>!v.workArrangements.includes('remote')||v.remoteRegions!==null,'remote_regions_required');
const envelope={schemaVersion:z.literal(2),idempotencyKey:profileUuid,expectedDraftVersion:profileRevision,expectedProfileVersion:profileRevision,expectedPreferenceVersion:profileRevision};
// S2A only: live source/provider/consent actions are not accidentally admitted.
export const profileCommandSchema=z.discriminatedUnion('action',[
 z.object({...envelope,action:z.literal('save_draft'),payload:z.object({profile:manualProfileSchema}).strict()}).strict(),
 z.object({...envelope,action:z.literal('save_preferences'),payload:z.object({preferences:preferencesSchema}).strict()}).strict(),
 z.object({...envelope,action:z.literal('confirm'),payload:z.object({draftHash:profileHash,consentVersion:profileRevision}).strict()}).strict(),
]);
export type ProfileCommand=z.infer<typeof profileCommandSchema>;
export function profileMissingFields(profile:z.infer<typeof manualProfileSchema>|null,preferences:z.infer<typeof preferencesSchema>|null):string[]{
 const missing:string[]=[];
 if(!profile)return ['profile',...(!preferences?['preferences']:[])];
 if(!profile.displayName)missing.push('displayName');
 if(!profile.currentLocation)missing.push('currentLocation.city','currentLocation.countryCode');
 if(profile.skills.length===0)missing.push('skills');
 if(!preferences)missing.push('preferences');
 return missing;
}
