// One-off import: creates the "Relief Care bd" channel, its categories, and
// its product catalog as real rows, so a real storefront app can serve them
// via the existing /api/store/:channelSlug/* API. Safe to re-run — every
// write is an upsert keyed on a stable slug/sku.
//
// Run with: npx ts-node prisma/import-relief-care.ts
//
// Known, deliberate simplifications (see the plan this was built from):
// - costPrice is 0 for every product — no real cost data exists yet.
// - Every product starts at 0 stock — set real stock via the Inventory page.
// - Size/flavor variants become separate products (schema has no variant model).
// - No images are set — the storefront renders a placeholder for now.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CHANNEL = { name: 'Relief Care bd', slug: 'relief-care-bd' };

const CATS: { id: string; name: string; slug: string }[] = [
  { id: 'kit', name: 'সমাধান কিট', slug: 'solution-kits' },
  { id: 'pain', name: 'ব্যথা উপশম', slug: 'pain-relief' },
  { id: 'skin', name: 'ত্বক ও চর্মরোগ', slug: 'skin-care' },
  { id: 'cold', name: 'সর্দি-কাশি ও গলা', slug: 'cold-flu' },
  { id: 'oral', name: 'দাঁত ও মুখের যত্ন', slug: 'oral-care' },
  { id: 'hair', name: 'চুলের যত্ন', slug: 'hair-care' },
  { id: 'foot', name: 'পায়ের যত্ন', slug: 'foot-care' },
  { id: 'baby', name: 'মা ও শিশু', slug: 'baby-mother-care' },
  { id: 'herbal', name: 'হারবাল ও সুস্থতা', slug: 'herbal-wellness' },
  { id: 'combo', name: 'কম্বো অফার', slug: 'combo-offers' },
];

// [id, name, benefit/description, categoryId, price, compareAtPrice, sold]
const RAW: [number, string, string, string, number, number, number][] = [
  [1, 'ব্যথা নিরাময় তৈল', 'জয়েন্ট ও কোমর ব্যথায় মালিশ', 'pain', 800, 850, 320],
  [2, 'Deep Heat Pain Relief Spray', 'মাংসপেশির ব্যথায় তাৎক্ষণিক আরাম', 'pain', 650, 0, 410],
  [3, 'Tiger Balm Red Ointment', 'মাথা ও শরীর ব্যথায় গরম বাম', 'pain', 380, 530, 890],
  [4, 'Volini Gel', 'বহুমুখী ব্যথানাশক জেল', 'pain', 480, 620, 640],
  [5, 'Volini Pain Relief Spray', 'পেশী ও জয়েন্টের ব্যথায় স্প্রে', 'pain', 500, 670, 520],
  [6, 'Hot & Strong Pain Relief Gel', 'মাংসপেশি ও জয়েন্টের ব্যথা', 'pain', 250, 320, 280],
  [7, 'Cipla Omnigel', 'বহুমুখী ব্যথানাশক জেল', 'pain', 500, 640, 300],
  [8, 'Amrutanjan Extra Power', 'তীব্র মাথাব্যথা উপশমে', 'pain', 220, 360, 510],
  [9, 'Leeford Vovedic Plus Spray', 'মাংসপেশি ও হাড়ের ব্যথা', 'pain', 360, 420, 150],
  [10, 'Headache Relaxation Roll-on', 'মাইগ্রেনে দ্রুত আরাম', 'pain', 230, 380, 340],
  [11, 'Advanced Back Pain Roll-on', 'তীব্র কোমর ব্যথায় হিট থেরাপি', 'pain', 350, 475, 260],
  [12, 'Bio Active AX-Oil', 'পেইন রিলিফ ম্যাসাজ অয়েল', 'pain', 220, 0, 180],
  [13, 'Original Zandu Balm', 'মাথাব্যথা ও সর্দিতে', 'pain', 180, 220, 720],
  [14, 'Zandu Ultra Power Balm', 'তীব্র মাথাব্যথা ও শরীর ব্যথা', 'pain', 200, 0, 430],
  [15, 'Green Seven Crocodile Balm', 'তীব্র ব্যথা ও ক্লান্তিতে', 'pain', 320, 450, 380],
  [16, 'Green Seven Herb Massage Balm', 'থাই হারবাল ম্যাসাজ বাম', 'pain', 360, 490, 210],
  [17, 'Radian Massage Cream', 'ব্যথানাশক ম্যাসাজ ক্রিম', 'pain', 680, 0, 120],
  [18, 'Cold Mints Balm', 'থাই ব্যথা রিলিফ বাম', 'pain', 250, 0, 190],
  [19, 'Tiger Balm White Ointment', 'মাথাব্যথা ও নাক বন্ধে', 'pain', 400, 520, 460],
  [20, 'Stopderma KT Cream', 'দাদ, একজিমা, চুলকানি', 'skin', 200, 390, 980],
  [21, 'Argussy Acne Spot Remover', 'ব্রণ ও ব্রণের দাগ দূর করে', 'skin', 480, 550, 240],
  [22, 'Bio Active Acne Clear Face Wash', 'ব্রণ প্রবণ ত্বকের ফেসওয়াশ', 'skin', 600, 750, 200],
  [23, 'Two Snakes Cream', 'কঠিন এলার্জির সহজ সমাধান', 'skin', 250, 0, 330],
  [24, 'GSK Betnovate-N Cream 25g', 'ত্বকের প্রদাহ ও সংক্রমণে', 'skin', 180, 230, 560],
  [25, 'Clobeta GM Cream (২ পিস)', 'এলার্জি ও চুলকানির সমাধান', 'skin', 160, 200, 610],
  [26, 'Derobin Compound Ointment', 'ত্বকের সুরক্ষায় নির্ভরযোগ্য', 'skin', 300, 420, 170],
  [27, 'Clotrimazole Dusting Powder', 'ফাঙ্গাল, ঘামাচি ও চুলকানি', 'skin', 560, 0, 230],
  [28, 'Lemon Clear Dark Spot Cream', 'ঘাড়, বগলের কালো দাগ', 'skin', 480, 520, 190],
  [29, 'Mupixen Mupirocin 5g', 'ক্ষত ও ছোট কাটায় দ্রুত আরাম', 'skin', 220, 380, 310],
  [30, 'Skineal Cream', 'দাদ, একজিমা ও চুলকানি', 'skin', 250, 300, 370],
  [31, 'Itch Guard Plus Cream', 'তীব্র চুলকানি উপশম', 'skin', 250, 340, 450],
  [32, 'Salical Strong Ointment (২ পিস)', 'দাদের নিরাময়', 'skin', 360, 480, 260],
  [33, 'Vin21 Anti-Melasma Cream', 'মেছতা ও দাগ হালকা করে', 'skin', 580, 720, 140],
  [34, 'Sumifun Wart Remover', 'আঁচিল ও কর্ন দূর করে', 'skin', 300, 380, 160],
  [35, 'Asepso Sport Antibacterial Soap', 'সুস্থ ত্বক, সক্রিয় জীবন', 'skin', 400, 520, 290],
  [36, 'Leeford Scrabic Permethrin Soap', 'চর্মের পরিচ্ছন্নতা ও সুরক্ষা', 'skin', 230, 270, 220],
  [37, 'Snake Brand Cooling Powder', 'গরমে ঠান্ডা অনুভূতি, ঘামাচি', 'skin', 390, 450, 250],
  [38, 'Vaseline Cocoa Butter', 'শুষ্ক ত্বকের কোমল যত্ন', 'skin', 390, 510, 300],
  [39, 'Vaseline Rosy Lips Tin', 'গোলাপি আভার লিপবাম', 'skin', 260, 0, 270],
  [40, 'Oral-B Superfloss', 'দাঁতের ফাঁকের প্লাক রিমুভার', 'oral', 350, 430, 150],
  [41, 'Oral-B Essential Floss', 'দাঁতের যত্নে প্রতিদিনের সঙ্গী', 'oral', 350, 420, 210],
  [42, 'Charcoal Toothpaste', 'দাঁতের দাগ দূর করে', 'oral', 600, 720, 180],
  [43, 'Kodomo Kids Toothpaste', 'বাচ্চাদের নিরাপদ টুথপেস্ট', 'oral', 200, 350, 340],
  [44, 'Kodomo Kids Mouthwash', 'বাচ্চাদের মুখের যত্ন', 'oral', 650, 790, 110],
  [45, 'Fresh Breath Mouth Spray', 'মুখের দুর্গন্ধ দূর করে', 'oral', 300, 380, 200],
  [46, 'Rivaj UK Sweet Breath Spray', 'মিন্ট ফ্লেভার মাউথ স্প্রে', 'oral', 250, 350, 170],
  [47, 'Nizoral Anti-Dandruff Shampoo', 'খুশকি ও স্ক্যাল্পের সমস্যায়', 'hair', 1450, 1600, 190],
  [48, 'Mediker Anti-Lice Shampoo', '১০০% কার্যকর উকুননাশক', 'hair', 250, 320, 280],
  [49, 'Mediker Natural Anti Lice Oil', 'উকুন দূর করার তেল', 'hair', 220, 340, 230],
  [50, 'Indulekha Bringha Hair Oil', 'চুল পড়া কমায়, আয়ুর্বেদিক', 'hair', 750, 830, 260],
  [51, 'Navratna Cool Oil', 'মাথা ঠান্ডা রাখে, আয়ুর্বেদিক', 'hair', 420, 500, 240],
  [52, 'Vicks VapoRub', 'সর্দি, কাশি ও নাক বন্ধে', 'cold', 520, 680, 700],
  [53, 'Vicks Baby Rub', 'শিশুদের সর্দিতে কোমল আরাম', 'cold', 380, 490, 330],
  [54, 'Strepsils Lozenges', 'গলা ব্যথা ও খুসখুসে ভাব', 'cold', 650, 750, 290],
  [56, 'Dabur Honitus Herbal Syrup', 'আয়ুর্বেদিক কাশির সিরাপ', 'cold', 690, 760, 210],
  [57, 'POY-SIAN Inhaler', 'থাইল্যান্ডের ২-ইন-১ ইনহেলার', 'cold', 150, 190, 820],
  [58, 'Green Seven Aroma Inhaler', 'হার্বস ইনহেলার', 'cold', 320, 0, 160],
  [59, 'Dr Rhazes Foot Cream', 'পা ও গোড়ালির ফাটা দূর করে', 'foot', 200, 360, 420],
  [60, 'Krack Heel Repair Cream', 'পা ফাটা ক্রিম', 'foot', 240, 380, 390],
  [61, 'Herbal Heel Balm', 'পা ফাটা দূর করার ক্রিম', 'foot', 550, 0, 130],
  [62, 'Bio Active Foot Cream', 'পা ফাটা নিরাময়', 'foot', 520, 670, 150],
  [63, 'Dabur Lal Tail', 'বেবি ম্যাসাজ অয়েল', 'baby', 520, 690, 360],
  [64, "Woodward's Gripe Water", 'শিশুর পেটের অস্বস্তিতে', 'baby', 250, 0, 300],
  [65, "Palmer's Stretch Marks Cream", 'স্ট্রেচ মার্ক ম্যাসাজ ক্রিম', 'baby', 1050, 0, 140],
  [66, "Pax Moly Mom's Care", 'ফাটা দাগ ও স্ট্রেচ মার্ক', 'baby', 950, 1240, 110],
  [67, 'Dr. James Stretch Mark Cream', 'গর্ভকালীন দাগের যত্ন', 'baby', 990, 1200, 120],
  [68, 'Odomos Mosquito Cream', 'মশা থেকে সুরক্ষা', 'baby', 250, 340, 350],
  [69, 'Himalaya Ashwagandha', 'মন ও শরীরের শক্তি', 'herbal', 750, 890, 200],
  [70, 'Dabur Nature Care', 'কোষ্ঠকাঠিন্য ও গ্যাস্ট্রিক', 'herbal', 450, 520, 230],
  [71, 'Carebeau Body Massage Oil', 'ত্বক নরম ও কোমল', 'herbal', 1050, 1200, 90],
  [72, 'Mouth & Skin Hygiene Spray', 'ত্বক ও শরীরের সতেজতা', 'herbal', 280, 450, 120],
  [73, 'Family Pain Relief কম্বো', 'Moov, Axe Oil, VapoRub, BabyRub ও Green Seven', 'combo', 1490, 1610, 260],
  [74, 'পা ফাটা কম্বো', 'Dr Rhazes Foot Cream + Krack Heel Cream', 'combo', 399, 620, 180],
  [75, 'সর্দি-কাশি কম্বো', 'Vicks VapoRub + Strepsils + POY-SIAN', 'combo', 1190, 1620, 210],
  [76, 'দাদ-চুলকানি কম্বো', 'Stopderma KT + Itch Guard + Permethrin Soap', 'combo', 620, 1000, 240],
];

const KITS: { id: number; name: string; benefit: string; items: number[]; price: number }[] = [
  { id: 101, name: 'দাদ-চুলকানি নিরাময় কিট', benefit: 'ক্রিম + পাউডার + সাবান + গাইড', items: [30, 27, 35], price: 1090 },
  { id: 102, name: 'ঘাড়-কোমর ব্যথা কিট', benefit: 'জেল + হিট রোল-অন + বাম + গাইড', items: [4, 11, 13], price: 909 },
  { id: 103, name: 'সর্দি-কাশি আরাম কিট', benefit: 'ভেপোরাব + লজেন্স + ইনহেলার + গাইড', items: [52, 54, 57], price: 1190 },
  { id: 104, name: 'পা ফাটা সারানো কিট', benefit: 'হিল ক্রিম + ময়েশ্চারাইজার + গাইড', items: [60, 38], price: 569 },
  { id: 105, name: 'উকুন দূর করার কিট', benefit: 'শ্যাম্পু + তেল + গাইড', items: [48, 49], price: 429 },
];

// "Our picks" in the artifact — carried over as isFeatured on this channel.
const PICKS = new Set([3, 20, 52, 57, 4, 13]);

// Explicit slugs for the handful of Bengali-named products/kits, since
// slugify() strips non-ASCII and would otherwise collapse them to an
// auto-suffixed fallback.
const SLUG_OVERRIDES: Record<string, string> = {
  'p1': 'pain-relief-massage-oil',
  'p74': 'cracked-heel-combo',
  'p75': 'cold-cough-combo',
  'p76': 'ringworm-itching-combo',
  'k101': 'ringworm-itching-kit',
  'k102': 'neck-back-pain-kit',
  'k103': 'cold-cough-relief-kit',
  'k104': 'cracked-heel-repair-kit',
  'k105': 'lice-removal-kit',
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  console.log('Upserting channel...');
  const channel = await prisma.channel.upsert({
    where: { slug: CHANNEL.slug },
    update: {},
    create: { ...CHANNEL, isActive: true },
  });

  console.log('Upserting categories...');
  const categoryIdByKey: Record<string, string> = {};
  for (const c of CATS) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: { name: c.name, slug: c.slug, isPublished: true },
    });
    categoryIdByKey[c.id] = row.id;
  }

  console.log('Importing products...');
  let created = 0;
  let published = 0;
  const slugByArtifactId: Record<string, string> = {};

  for (const [id, name, benefit, catKey, price, compareAt] of RAW) {
    const sku = `RC-${id}`;
    const product = await prisma.product.upsert({
      where: { sku },
      update: {
        name,
        description: benefit,
        basePrice: price,
        categoryId: categoryIdByKey[catKey],
      },
      create: {
        sku,
        name,
        description: benefit,
        costPrice: 0,
        basePrice: price,
        categoryId: categoryIdByKey[catKey],
      },
    });
    created++;

    const slug = SLUG_OVERRIDES[`p${id}`] || slugify(name) || `product-${product.id.slice(-8)}`;
    slugByArtifactId[`p${id}`] = slug;

    await prisma.productChannel.upsert({
      where: { productId_channelId: { productId: product.id, channelId: channel.id } },
      update: {
        price,
        compareAtPrice: compareAt || null,
        isPublished: true,
        isFeatured: PICKS.has(id),
      },
      create: {
        productId: product.id,
        channelId: channel.id,
        slug,
        price,
        compareAtPrice: compareAt || null,
        isPublished: true,
        isFeatured: PICKS.has(id),
      },
    });
    published++;

    const existingInventory = await prisma.inventory.findUnique({ where: { productId: product.id } });
    if (!existingInventory) {
      await prisma.inventory.create({
        data: { productId: product.id, currentStock: 0, reservedStock: 0 },
      });
    }
  }

  console.log('Importing solution kits...');
  // A kit's SKU-id namespace is kept distinct from regular products (K-prefix)
  // even though the artifact shared one id space — avoids ever colliding.
  const priceById = new Map(RAW.map(([id, , , , price]) => [id, price]));
  for (const kit of KITS) {
    const sku = `RC-K${kit.id}`;
    const compareAt = kit.items.reduce((sum, itemId) => sum + (priceById.get(itemId) || 0), 0);
    const product = await prisma.product.upsert({
      where: { sku },
      update: {
        name: kit.name,
        description: kit.benefit,
        basePrice: kit.price,
        categoryId: categoryIdByKey['kit'],
      },
      create: {
        sku,
        name: kit.name,
        description: kit.benefit,
        costPrice: 0,
        basePrice: kit.price,
        categoryId: categoryIdByKey['kit'],
      },
    });
    created++;

    const slug = SLUG_OVERRIDES[`k${kit.id}`] || slugify(kit.name) || `product-${product.id.slice(-8)}`;
    slugByArtifactId[`k${kit.id}`] = slug;

    await prisma.productChannel.upsert({
      where: { productId_channelId: { productId: product.id, channelId: channel.id } },
      update: { price: kit.price, compareAtPrice: compareAt || null, isPublished: true },
      create: {
        productId: product.id,
        channelId: channel.id,
        slug,
        price: kit.price,
        compareAtPrice: compareAt || null,
        isPublished: true,
      },
    });
    published++;

    const existingInventory = await prisma.inventory.findUnique({ where: { productId: product.id } });
    if (!existingInventory) {
      await prisma.inventory.create({
        data: { productId: product.id, currentStock: 0, reservedStock: 0 },
      });
    }
  }

  console.log(`Done. Channel: ${channel.name} (${channel.slug})`);
  console.log(`Products upserted: ${created}, channel listings published: ${published}`);
  console.log('All imported products start at 0 stock — set real stock via the Inventory page before launch.');

  // Dumped so the storefront app's quiz/complement maps can be re-keyed from
  // the artifact's old integer ids to these real, stable slugs.
  console.log('\nSlug map (artifact id -> real slug):');
  console.log(JSON.stringify(slugByArtifactId, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
