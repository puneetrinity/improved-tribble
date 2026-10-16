/** Format validation only. Geographic interpretation belongs to the AI/recruiter. */
import { z } from 'zod';
export const extractedLocationSchema = z.object({
  scope: z.enum(['city', 'country', 'unsupported']),
  city: z.string().trim().min(1).max(200).nullable(),
  country: z.string().trim().min(1).max(200).nullable(),
  workArrangement: z.string().trim().max(300).nullable(),
}).strict();
export type ExtractedLocation = z.infer<typeof extractedLocationSchema>;
const names = new Intl.DisplayNames(['en'], { type: 'region' });
// ISO 3166-1 alpha-2 country/territory codes, checked against the local iso-codes
// 3166-1 inventory. Do not enumerate arbitrary letter pairs: CLDR also names
// EU, UN, ZZ and other non-country regions. This is not a city/state geocoder.
export const LOCATION_COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const countries = new Set<string>();
for (const code of LOCATION_COUNTRY_CODES) {
  const name=names.of(code);
  if(name && name!==code)countries.add(name.toLowerCase());
}
// These names are valid inputs; do not rewrite them into supposedly equivalent
// names. Discover only aliases IN/US/USA/UK/GB; other spellings match literally.
for(const name of ['hong kong','macau','myanmar','ivory coast','united states','united kingdom','united arab emirates','turkey','czech republic','in','us','usa','uk','gb']) countries.add(name);
export type LocationProblem='empty'|'single_place'|'country_required'|'country_form'|'format'|'unsupported';
export function locationValueProblem(value:string):LocationProblem|null {
  const v=value.trim();
  if(!v)return 'empty';
  if(/[;/\n]|\b(?:or|and)\b/i.test(v))return 'single_place';
  if(/[()]|\b(?:remote|hybrid|on-site)\b/i.test(v)||/\.$/.test(v))return 'format';
  const parts=v.split(',').map(x=>x.trim());
  if(parts.length>2||parts.some(x=>!x))return 'format';
  if(['uae','united states of america'].includes(parts.at(-1)!.toLowerCase()))return 'country_form';
  return countries.has(parts.at(-1)!.toLowerCase())?null:'country_required';
}
export type LocationSplit={place:string|null;note:string|null};
/** Existing Details values are never parsed or geographically rewritten. */
export function splitLocation(raw:string):LocationSplit {
  return locationValueProblem(raw)===null?{place:raw.trim(),note:null}:{place:null,note:raw||null};
}
/** The model supplies meaning; code only checks shape and formats its fields. */
export function formatExtractedLocation(input:unknown):LocationSplit {
  const result=extractedLocationSchema.safeParse(input);
  if(!result.success)return {place:null,note:null};
  const l=result.data;
  if(l.scope==='unsupported'||!l.country||(l.scope==='city'?!l.city:l.city!==null))return {place:null,note:l.workArrangement};
  const place=l.scope==='city'?`${l.city}, ${l.country}`:l.country;
  return {place:locationValueProblem(place)===null?place:null,note:l.workArrangement||null};
}
export const LOCATION_EXTRACTION_INSTRUCTIONS = `For every location item add location: {"scope":"city"|"country"|"unsupported","city":string|null,"country":string|null,"workArrangement":string|null}. Interpret geography using the full JD context, worldwide. For a single city use its city name and the full English country name; for an explicitly country-wide requirement use country scope and city null. Resolve an unambiguous city/country from context; if uncertain, do not guess. Keep hybrid/remote/office frequency in workArrangement, not the place. Use unsupported for regions/states alone, multiple alternative places, exclusions, radius restrictions, or other geographic conditions a single city or country cannot faithfully express. Never broaden these to a country or choose one alternative. Preserve the entire original requirement in text and its exact JD quote, even when unsupported. Use United States, United Kingdom and United Arab Emirates as country spellings. Do not remove geographic restrictions into the work-arrangement note.`;
export function locationProblemText(value:string,problem:LocationProblem):string {
  switch(problem) {
    case 'empty':return 'Add the location.';
    case 'single_place':return 'Use one place. Several places need your review; they are not matched as alternatives.';
    case 'country_required':return 'End the location with a country, like "London, United Kingdom" or just "United Kingdom".';
    case 'country_form':return value.toLowerCase().includes('uae')?'Write the country as "United Arab Emirates", like "Dubai, United Arab Emirates".':'Write the country as "United States".';
    case 'unsupported':return 'This location needs your review; its original wording has been kept.';
    case 'format':return 'Use only the place (no full stop). Put hybrid, remote or office details under Work arrangement.';
  }
}
