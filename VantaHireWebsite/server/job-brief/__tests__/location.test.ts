import {describe,it,expect} from 'vitest';
import {formatExtractedLocation,splitLocation,locationValueProblem,LOCATION_COUNTRY_CODES} from '../../../shared/brief-location';
import {assembleReviewWorkspace,REQUIREMENT_EXTRACTION_PROMPT} from '../review';
import {currentBriefPayloadSchema,briefPayloadSchema} from '../contracts';

describe('AI-led worldwide location extraction',()=>{
  it('uses exactly 249 unique country/territory codes, excluding CLDR-only regions',()=>{
    expect(LOCATION_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(LOCATION_COUNTRY_CODES).size).toBe(249);
    for(const code of ['EU','UN','ZZ','QO','EZ','XA','XB'])expect(LOCATION_COUNTRY_CODES).not.toContain(code);
  });
  it.each(['Berlin, European Union','European Union','United Nations','Unknown Region','Outlying Oceania','Eurozone','Pseudo-Accents','Pseudo-Bidi'])('does not save non-country %s',value=>{
    expect(locationValueProblem(value)).toBe('country_required');
    expect(formatExtractedLocation({scope:'country',city:null,country:value,workArrangement:null}).place).toBeNull();
  });
  it.each(['Hong Kong','Macau','Myanmar','Ivory Coast'])('accepts %s without changing the spelling',country=>{
    expect(locationValueProblem(country)).toBeNull();
    expect(formatExtractedLocation({scope:'country',city:null,country,workArrangement:null})).toEqual({place:country,note:null});
  });
  it.each([
    ['Berlin','Germany'],['São Paulo','Brazil'],['Tokyo','Japan'],['Lagos','Nigeria'],
    ['Toronto','Canada'],['Sydney','Australia'],['Dubai','United Arab Emirates'],
    ['Bengaluru','India'],['London','United Kingdom'],['San Francisco','United States'],
  ])('formats the model city %s without reinterpreting it', (city,country)=>{
    const location={scope:'city',city,country,workArrangement:'hybrid, three days in office'};
    const quote=`Work in ${city}, ${country} (hybrid, three days in office).`;
    const w=assembleReviewWorkspace(JSON.stringify({overflow:false,items:[{text:quote,quote,topic:'location',priority:'required',terms:[],location}]}),quote);
    expect(w.proposal!.criteria[0]).toMatchObject({requirement:{kind:'text',value:`${city}, ${country}`},note:location.workArrangement});
    expect(w.items[0].quote).toBe(quote);
  });
  it.each(['Karnataka, India','California, United States','Paris or London','Within 50 km of Tokyo','Remote from Germany except Bavaria'])('keeps unsupported restriction %s visible',quote=>{
    const w=assembleReviewWorkspace(JSON.stringify({overflow:false,items:[{text:quote,quote,topic:'location',priority:'required',terms:[],location:{scope:'unsupported',city:null,country:null,workArrangement:null}}]}),quote);
    expect(w.proposal).toBeNull();expect(w.items[0]).toMatchObject({text:quote,quote,proposedCriterion:null});
  });
  it('formats country scope only when supplied explicitly, and never drops a city',()=>{
    expect(formatExtractedLocation({scope:'country',city:null,country:'Germany',workArrangement:'Remote'})).toEqual({place:'Germany',note:'Remote'});
    expect(formatExtractedLocation({scope:'country',city:'Berlin',country:'Germany',workArrangement:null}).place).toBeNull();
  });
  it('missing AI fields do not trigger a local geographic fallback',()=>{
    expect(formatExtractedLocation(undefined).place).toBeNull();
    expect(splitLocation('Remote from Berlin, Germany')).toEqual({place:null,note:'Remote from Berlin, Germany'});
    expect(splitLocation('Jaipur, Rajasthan, India').place).toBeNull();
  });
  it('rejects invalid shape and oversized notes rather than silently truncating',()=>{
    for(const location of [null,{scope:'city',city:null,country:'Germany',workArrangement:null},{scope:'city',city:'Berlin',country:'Germany',workArrangement:'x'.repeat(301)}])expect(formatExtractedLocation(location).place).toBeNull();
  });
  it('does not claim unsupported scorer grammar works worldwide',()=>{
    expect(locationValueProblem('Trinidad and Tobago')).not.toBeNull();
    expect(formatExtractedLocation({scope:'country',city:null,country:'Trinidad and Tobago',workArrangement:null}).place).toBeNull();
  });
  it('asks the existing model to interpret geography and retain restrictions',()=>{
    expect(REQUIREMENT_EXTRACTION_PROMPT).toContain('Interpret geography using the full JD context, worldwide');
    expect(REQUIREMENT_EXTRACTION_PROMPT).toContain('Never broaden these to a country');
  });
  it('keeps historical briefs readable but rejects arrangement prose on new saves',()=>{
    const quote='Berlin, Germany (hybrid)';
    const w=assembleReviewWorkspace(JSON.stringify({overflow:false,items:[{text:quote,quote,topic:'location',priority:'required',terms:[],location:{scope:'city',city:'Berlin',country:'Germany',workArrangement:'hybrid'}}]}),quote);
    const p=w.proposal!;
    expect(currentBriefPayloadSchema.safeParse(p).success).toBe(true);
    const old={...p,criteria:p.criteria.map(c=>({...c,requirement:{kind:'text',value:quote}}))};
    expect(briefPayloadSchema.safeParse(old).success).toBe(true);
    expect(currentBriefPayloadSchema.safeParse(old).success).toBe(false);
  });
  it('rejects a fabricated source quote even when the extracted location is well formed',()=>{
    const w=assembleReviewWorkspace(JSON.stringify({overflow:false,items:[{text:'Berlin',quote:'Berlin',topic:'location',priority:'required',terms:[],location:{scope:'city',city:'Berlin',country:'Germany',workArrangement:null}}]}),'Work in Paris, France.');
    expect(w.proposal).toBeNull();expect(w.items[0].reason).toBe('quote_not_found');
  });
});
