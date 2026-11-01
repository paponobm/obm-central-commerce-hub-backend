// All 64 Bangladesh districts, canonical English name + Bengali spelling(s)
// an address is likely to use. Deliberately district-only — thana/upazila
// is a much larger (~500-entry) list left for a later pass once the exact
// data/matching approach for it is decided.
//
// Matching is substring-based after stripping all whitespace/punctuation
// from both the address and each alias (see `normalize` below), so spacing
// differences like "কক্স বাজার" vs "কক্সবাজার" match without needing an
// explicit alias for every variant — only genuinely different spellings
// (renamed districts, English transliteration variants) need their own
// alias entry.
interface DistrictEntry {
  name: string;
  aliases: string[];
}

export const BD_DISTRICTS: DistrictEntry[] = [
  // Dhaka Division
  { name: 'Dhaka', aliases: ['dhaka', 'ঢাকা'] },
  { name: 'Faridpur', aliases: ['faridpur', 'ফরিদপুর'] },
  { name: 'Gazipur', aliases: ['gazipur', 'গাজীপুর'] },
  { name: 'Gopalganj', aliases: ['gopalganj', 'গোপালগঞ্জ'] },
  { name: 'Kishoreganj', aliases: ['kishoreganj', 'কিশোরগঞ্জ'] },
  { name: 'Madaripur', aliases: ['madaripur', 'মাদারীপুর'] },
  { name: 'Manikganj', aliases: ['manikganj', 'মানিকগঞ্জ'] },
  { name: 'Munshiganj', aliases: ['munshiganj', 'মুন্সিগঞ্জ'] },
  { name: 'Narayanganj', aliases: ['narayanganj', 'নারায়ণগঞ্জ'] },
  { name: 'Narsingdi', aliases: ['narsingdi', 'নরসিংদী'] },
  { name: 'Rajbari', aliases: ['rajbari', 'রাজবাড়ী'] },
  { name: 'Shariatpur', aliases: ['shariatpur', 'শরীয়তপুর'] },
  { name: 'Tangail', aliases: ['tangail', 'টাঙ্গাইল'] },

  // Chittagong Division
  { name: 'Bandarban', aliases: ['bandarban', 'বান্দরবান'] },
  { name: 'Brahmanbaria', aliases: ['brahmanbaria', 'ব্রাহ্মণবাড়িয়া'] },
  { name: 'Chandpur', aliases: ['chandpur', 'চাঁদপুর'] },
  {
    name: 'Chittagong',
    aliases: ['chittagong', 'chattogram', 'চট্টগ্রাম'],
  },
  { name: 'Comilla', aliases: ['comilla', 'cumilla', 'কুমিল্লা'] },
  {
    name: "Cox's Bazar",
    aliases: ["cox's bazar", 'coxs bazar', 'cox bazar', 'কক্সবাজার'],
  },
  { name: 'Feni', aliases: ['feni', 'ফেনী'] },
  { name: 'Khagrachhari', aliases: ['khagrachhari', 'খাগড়াছড়ি'] },
  { name: 'Lakshmipur', aliases: ['lakshmipur', 'লক্ষ্মীপুর'] },
  { name: 'Noakhali', aliases: ['noakhali', 'নোয়াখালী'] },
  { name: 'Rangamati', aliases: ['rangamati', 'রাঙ্গামাটি'] },

  // Rajshahi Division
  { name: 'Bogura', aliases: ['bogura', 'bogra', 'বগুড়া'] },
  { name: 'Chapainawabganj', aliases: ['chapainawabganj', 'চাঁপাইনবাবগঞ্জ'] },
  { name: 'Joypurhat', aliases: ['joypurhat', 'জয়পুরহাট'] },
  { name: 'Naogaon', aliases: ['naogaon', 'নওগাঁ'] },
  { name: 'Natore', aliases: ['natore', 'নাটোর'] },
  { name: 'Pabna', aliases: ['pabna', 'পাবনা'] },
  { name: 'Rajshahi', aliases: ['rajshahi', 'রাজশাহী'] },
  { name: 'Sirajganj', aliases: ['sirajganj', 'সিরাজগঞ্জ'] },

  // Khulna Division
  { name: 'Bagerhat', aliases: ['bagerhat', 'বাগেরহাট'] },
  { name: 'Chuadanga', aliases: ['chuadanga', 'চুয়াডাঙ্গা'] },
  { name: 'Jashore', aliases: ['jashore', 'jessore', 'যশোর'] },
  { name: 'Jhenaidah', aliases: ['jhenaidah', 'ঝিনাইদহ'] },
  { name: 'Khulna', aliases: ['khulna', 'খুলনা'] },
  { name: 'Kushtia', aliases: ['kushtia', 'কুষ্টিয়া'] },
  { name: 'Magura', aliases: ['magura', 'মাগুরা'] },
  { name: 'Meherpur', aliases: ['meherpur', 'মেহেরপুর'] },
  { name: 'Narail', aliases: ['narail', 'নড়াইল'] },
  { name: 'Satkhira', aliases: ['satkhira', 'সাতক্ষীরা'] },

  // Barisal Division
  { name: 'Barguna', aliases: ['barguna', 'বরগুনা'] },
  { name: 'Barisal', aliases: ['barisal', 'barishal', 'বরিশাল'] },
  { name: 'Bhola', aliases: ['bhola', 'ভোলা'] },
  { name: 'Jhalokati', aliases: ['jhalokati', 'ঝালকাঠি'] },
  { name: 'Patuakhali', aliases: ['patuakhali', 'পটুয়াখালী'] },
  { name: 'Pirojpur', aliases: ['pirojpur', 'পিরোজপুর'] },

  // Sylhet Division
  { name: 'Habiganj', aliases: ['habiganj', 'হবিগঞ্জ'] },
  { name: 'Moulvibazar', aliases: ['moulvibazar', 'মৌলভীবাজার'] },
  { name: 'Sunamganj', aliases: ['sunamganj', 'সুনামগঞ্জ'] },
  { name: 'Sylhet', aliases: ['sylhet', 'সিলেট'] },

  // Rangpur Division
  { name: 'Dinajpur', aliases: ['dinajpur', 'দিনাজপুর'] },
  { name: 'Gaibandha', aliases: ['gaibandha', 'গাইবান্ধা'] },
  { name: 'Kurigram', aliases: ['kurigram', 'কুড়িগ্রাম'] },
  { name: 'Lalmonirhat', aliases: ['lalmonirhat', 'লালমনিরহাট'] },
  { name: 'Nilphamari', aliases: ['nilphamari', 'নীলফামারী'] },
  { name: 'Panchagarh', aliases: ['panchagarh', 'পঞ্চগড়'] },
  { name: 'Rangpur', aliases: ['rangpur', 'রংপুর'] },
  { name: 'Thakurgaon', aliases: ['thakurgaon', 'ঠাকুরগাঁও'] },

  // Mymensingh Division
  { name: 'Jamalpur', aliases: ['jamalpur', 'জামালপুর'] },
  { name: 'Mymensingh', aliases: ['mymensingh', 'ময়মনসিংহ'] },
  { name: 'Netrokona', aliases: ['netrokona', 'netrokona', 'নেত্রকোণা'] },
  { name: 'Sherpur', aliases: ['sherpur', 'শেরপুর'] },
];

// Unicode-aware: strips everything except letters/digits so spacing,
// punctuation, and apostrophes never cause an otherwise-matching address
// to miss.
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

const NORMALIZED_DISTRICTS = BD_DISTRICTS.map((d) => ({
  name: d.name,
  aliases: d.aliases.map(normalize),
}));

// Longest-alias-first within each district so e.g. "cox's bazar" is tried
// before any shorter/ambiguous fragment could match first.
for (const d of NORMALIZED_DISTRICTS) {
  d.aliases.sort((a, b) => b.length - a.length);
}

// Canonical names only — for validating a manually-chosen district (see
// UpdateCustomerDto) without re-exporting the alias lists.
export const BD_DISTRICT_NAMES = BD_DISTRICTS.map((d) => d.name);

export function detectDistrict(address: string | null | undefined): string | null {
  if (!address) return null;
  const norm = normalize(address);
  if (!norm) return null;
  for (const d of NORMALIZED_DISTRICTS) {
    if (d.aliases.some((alias) => alias.length > 0 && norm.includes(alias))) {
      return d.name;
    }
  }
  return null;
}
