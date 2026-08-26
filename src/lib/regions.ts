export const REGION_MAP: Record<string, readonly string[]> = {
  africa: ['DZ','AO','BJ','BW','BF','BI','CV','CM','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW'],
  asia: ['AF','AM','AZ','BH','BD','BT','BN','KH','CN','CY','GE','IN','ID','IR','IQ','IL','JP','JO','KZ','KW','KG','LA','LB','MY','MV','MN','MM','NP','KP','OM','PK','PH','QA','SA','SG','KR','LK','SY','TW','TJ','TH','TL','TR','TM','AE','UZ','VN','YE'],
  europe: ['AL','AD','AT','BY','BE','BA','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','GB'],
  north_america: ['AG','BS','BB','BZ','CA','CR','CU','DM','DO','SV','GD','GT','HT','HN','JM','MX','NI','PA','KN','LC','VC','TT','US'],
  south_america: ['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE'],
  oceania: ['AU','FJ','KI','MH','FM','NR','NZ','PW','PG','WS','SB','TO','TV','VU'],
} as const

export const REGION_LABELS: Record<string, string> = { africa: 'Africa', asia: 'Asia', europe: 'Europe', north_america: 'N. America', south_america: 'S. America', oceania: 'Oceania' }

export const CONTINENTS: readonly (readonly [string, string])[] = [
  ['asia', 'Asia'], ['europe', 'Europe'], ['africa', 'Africa'],
  ['north_america', 'N. America'], ['south_america', 'S. America'], ['oceania', 'Oceania'],
]

export const COUNTRY_NAMES: Record<string, string> = {
  DZ:'Algeria',AO:'Angola',BJ:'Benin',BW:'Botswana',BF:'Burkina Faso',BI:'Burundi',CV:'Cape Verde',
  CM:'Cameroon',CF:'Central African Rep.',TD:'Chad',KM:'Comoros',CG:'Congo',CD:'DR Congo',
  CI:'Ivory Coast',DJ:'Djibouti',EG:'Egypt',GQ:'Equatorial Guinea',ER:'Eritrea',SZ:'Eswatini',
  ET:'Ethiopia',GA:'Gabon',GM:'Gambia',GH:'Ghana',GN:'Guinea',GW:'Guinea-Bissau',KE:'Kenya',
  LS:'Lesotho',LR:'Liberia',LY:'Libya',MG:'Madagascar',MW:'Malawi',ML:'Mali',MR:'Mauritania',
  MU:'Mauritius',MA:'Morocco',MZ:'Mozambique',NA:'Namibia',NE:'Niger',NG:'Nigeria',RW:'Rwanda',
  ST:'São Tomé',SN:'Senegal',SC:'Seychelles',SL:'Sierra Leone',SO:'Somalia',ZA:'South Africa',
  SS:'South Sudan',SD:'Sudan',TZ:'Tanzania',TG:'Togo',TN:'Tunisia',UG:'Uganda',ZM:'Zambia',ZW:'Zimbabwe',
  AF:'Afghanistan',AM:'Armenia',AZ:'Azerbaijan',BH:'Bahrain',BD:'Bangladesh',BT:'Bhutan',BN:'Brunei',
  KH:'Cambodia',CN:'China',CY:'Cyprus',GE:'Georgia',IN:'India',ID:'Indonesia',IR:'Iran',IQ:'Iraq',
  IL:'Israel',JP:'Japan',JO:'Jordan',KZ:'Kazakhstan',KW:'Kuwait',KG:'Kyrgyzstan',LA:'Laos',
  LB:'Lebanon',MY:'Malaysia',MV:'Maldives',MN:'Mongolia',MM:'Myanmar',NP:'Nepal',KP:'North Korea',
  OM:'Oman',PK:'Pakistan',PH:'Philippines',QA:'Qatar',SA:'Saudi Arabia',SG:'Singapore',KR:'South Korea',
  LK:'Sri Lanka',SY:'Syria',TW:'Taiwan',TJ:'Tajikistan',TH:'Thailand',TL:'Timor-Leste',TR:'Turkey',
  TM:'Turkmenistan',AE:'UAE',UZ:'Uzbekistan',VN:'Vietnam',YE:'Yemen',
  AL:'Albania',AD:'Andorra',AT:'Austria',BY:'Belarus',BE:'Belgium',BA:'Bosnia',BG:'Bulgaria',
  HR:'Croatia',CZ:'Czechia',DK:'Denmark',EE:'Estonia',FI:'Finland',FR:'France',DE:'Germany',
  GR:'Greece',HU:'Hungary',IS:'Iceland',IE:'Ireland',IT:'Italy',XK:'Kosovo',LV:'Latvia',
  LI:'Liechtenstein',LT:'Lithuania',LU:'Luxembourg',MT:'Malta',MD:'Moldova',MC:'Monaco',ME:'Montenegro',
  NL:'Netherlands',MK:'North Macedonia',NO:'Norway',PL:'Poland',PT:'Portugal',RO:'Romania',RU:'Russia',
  SM:'San Marino',RS:'Serbia',SK:'Slovakia',SI:'Slovenia',ES:'Spain',SE:'Sweden',CH:'Switzerland',
  UA:'Ukraine',GB:'United Kingdom',
  AG:'Antigua',BS:'Bahamas',BB:'Barbados',BZ:'Belize',CA:'Canada',CR:'Costa Rica',CU:'Cuba',
  DM:'Dominica',DO:'Dominican Rep.',SV:'El Salvador',GD:'Grenada',GT:'Guatemala',HT:'Haiti',
  HN:'Honduras',JM:'Jamaica',MX:'Mexico',NI:'Nicaragua',PA:'Panama',KN:'St Kitts',LC:'St Lucia',
  VC:'St Vincent',TT:'Trinidad',US:'United States',
  AR:'Argentina',BO:'Bolivia',BR:'Brazil',CL:'Chile',CO:'Colombia',EC:'Ecuador',GY:'Guyana',
  PY:'Paraguay',PE:'Peru',SR:'Suriname',UY:'Uruguay',VE:'Venezuela',
  AU:'Australia',FJ:'Fiji',KI:'Kiribati',MH:'Marshall Islands',FM:'Micronesia',NR:'Nauru',
  NZ:'New Zealand',PW:'Palau',PG:'Papua New Guinea',WS:'Samoa',SB:'Solomon Islands',TO:'Tonga',
  TV:'Tuvalu',VU:'Vanuatu',
}

export function getRegionForCountry(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  for (const [region, countries] of Object.entries(REGION_MAP)) {
    if (countries.includes(upper)) return region
  }
  return null
}

export function getCountriesForRegion(region: string): readonly (readonly [string, string])[] {
  const codes = REGION_MAP[region]
  if (!codes) return []
  return codes.map((c) => [c, COUNTRY_NAMES[c] ?? c] as const).sort((a, b) => a[1].localeCompare(b[1]))
}

export function getCountryName(code: string | null): string | null {
  if (!code) return null
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase()
}
