import { LOCATION_COUNTRY_CODES } from '@shared/brief-location';

/**
 * Places a résumé heading may name between a role and its dates ("Engineer, Acme | Pune   Jan 2022").
 * Used ONLY to decide whether text in that gap is a location, so dates written after it can be bound
 * to the role. It is deliberately a closed list: a place not listed here does not bind, and the dates
 * are withheld for the candidate to add. That is the safe direction; an unknown field could be another
 * job ("Manager at Beta"). India-first, then major hubs worldwide. Lowercase, no punctuation.
 */
const CITIES = [
  // India: metros, tech hubs, state capitals, common alternate spellings.
  'bengaluru', 'bangalore', 'mumbai', 'bombay', 'navi mumbai', 'thane', 'delhi', 'new delhi', 'delhi ncr', 'ncr', 'gurugram', 'gurgaon',
  'noida', 'greater noida', 'faridabad', 'ghaziabad', 'chennai', 'madras', 'hyderabad', 'secunderabad', 'pune', 'kolkata', 'calcutta',
  'ahmedabad', 'gandhinagar', 'surat', 'vadodara', 'baroda', 'jaipur', 'lucknow', 'kanpur', 'chandigarh', 'mohali', 'panchkula',
  'indore', 'bhopal', 'nagpur', 'nashik', 'aurangabad', 'kochi', 'cochin', 'thiruvananthapuram', 'trivandrum', 'kozhikode', 'calicut',
  'coimbatore', 'madurai', 'tiruchirappalli', 'trichy', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'visakhapatnam', 'vizag',
  'vijayawada', 'guntur', 'bhubaneswar', 'cuttack', 'patna', 'ranchi', 'jamshedpur', 'raipur', 'guwahati', 'shillong', 'dehradun',
  'shimla', 'jammu', 'srinagar', 'amritsar', 'ludhiana', 'jalandhar', 'varanasi', 'prayagraj', 'allahabad', 'agra', 'meerut', 'udaipur',
  'jodhpur', 'goa', 'panaji', 'pondicherry', 'puducherry', 'manipal', 'vellore', 'warangal', 'rajkot', 'gwalior', 'jabalpur',
  // World hubs.
  'london', 'manchester', 'edinburgh', 'dublin', 'paris', 'berlin', 'munich', 'frankfurt', 'hamburg', 'amsterdam', 'rotterdam',
  'brussels', 'zurich', 'geneva', 'vienna', 'stockholm', 'copenhagen', 'oslo', 'helsinki', 'madrid', 'barcelona', 'lisbon', 'milan',
  'rome', 'warsaw', 'krakow', 'prague', 'budapest', 'bucharest', 'tallinn', 'new york', 'new york city', 'nyc', 'san francisco',
  'bay area', 'san jose', 'mountain view', 'palo alto', 'menlo park', 'sunnyvale', 'santa clara', 'cupertino', 'redmond', 'seattle',
  'los angeles', 'san diego', 'boston', 'chicago', 'austin', 'dallas', 'houston', 'atlanta', 'denver', 'washington', 'washington dc',
  'philadelphia', 'pittsburgh', 'phoenix', 'miami', 'raleigh', 'portland', 'minneapolis', 'detroit', 'toronto', 'vancouver', 'montreal',
  'ottawa', 'calgary', 'waterloo', 'mexico city', 'sao paulo', 'buenos aires', 'bogota', 'santiago', 'lima', 'dubai', 'abu dhabi',
  'doha', 'riyadh', 'jeddah', 'kuwait city', 'muscat', 'manama', 'tel aviv', 'cairo', 'nairobi', 'lagos', 'johannesburg', 'cape town',
  'singapore', 'kuala lumpur', 'jakarta', 'bangkok', 'manila', 'ho chi minh city', 'hanoi', 'hong kong', 'shanghai', 'beijing',
  'shenzhen', 'taipei', 'seoul', 'tokyo', 'osaka', 'sydney', 'melbourne', 'brisbane', 'perth', 'auckland', 'wellington', 'colombo',
  'dhaka', 'karachi', 'lahore', 'islamabad', 'kathmandu',
];
const REGIONS = [
  'karnataka', 'maharashtra', 'tamil nadu', 'telangana', 'andhra pradesh', 'kerala', 'gujarat', 'rajasthan', 'uttar pradesh',
  'madhya pradesh', 'west bengal', 'haryana', 'punjab', 'odisha', 'orissa', 'bihar', 'jharkhand', 'chhattisgarh', 'assam',
  'uttarakhand', 'himachal pradesh', 'california', 'texas', 'new york state', 'washington state', 'massachusetts', 'illinois',
  'ontario', 'british columbia', 'england', 'scotland', 'wales', 'bavaria', 'new south wales', 'victoria',
];
const COUNTRY_ALIASES = ['usa', 'us', 'u s', 'u s a', 'united states of america', 'america', 'uk', 'u k', 'great britain', 'britain', 'uae', 'u a e', 'ksa'];
const WORK_MODES = ['remote', 'fully remote', 'hybrid', 'on site', 'onsite', 'on-site', 'in office', 'work from home', 'wfh'];

const key = (v: string) => v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.'’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const countryNames = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return LOCATION_COUNTRY_CODES.map(c => names.of(c) ?? '').filter(Boolean);
  } catch { return []; }
})();
const PLACES = new Set([...CITIES, ...REGIONS, ...COUNTRY_ALIASES, ...WORK_MODES.map(key), ...countryNames].map(key));

/** True when `field` (one separator-delimited field of a heading line) is a known place or work mode. */
export function isKnownPlace(field: string): boolean {
  const k = key(field);
  return k.length > 0 && PLACES.has(k);
}
