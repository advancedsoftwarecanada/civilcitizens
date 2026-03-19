import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const TASK_PROMPT_ROOT = fileURLToPath(new URL('../prompts/tasks/', import.meta.url))

const MarketplaceCategoryInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(8000),
})

const MarketplaceCategoryOutput = z.object({
  section: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(120),
  subcategory: z.string().trim().min(1).max(180),
  detail: z.string().trim().min(1).max(220).nullable(),
})

const MarketplaceDescriptionInput = z.object({
  title: z.string().trim().min(1).max(160),
  categoryPath: z.string().trim().min(1).max(500).optional().nullable(),
  condition: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(8000).optional().nullable(),
})

const MarketplaceDescriptionOutput = z.object({
  description: z.string().trim().min(1).max(8000),
})

const JobDescriptionInput = z.object({
  title: z.string().trim().min(1).max(160),
  organizationName: z.string().trim().max(160).optional().nullable(),
  location: z.string().trim().max(160).optional().nullable(),
  responsibilities: z.string().trim().max(8000).optional().nullable(),
  requirements: z.string().trim().max(8000).optional().nullable(),
  notes: z.string().trim().max(8000).optional().nullable(),
})

const JobDescriptionOutput = z.object({
  description: z.string().trim().min(1).max(12000),
})

const promptCache = new Map<string, string>()

export const AiTaskRequestBody = z.object({
  input: z.record(z.string(), z.unknown()),
  serverId: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(240).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  topP: z.coerce.number().min(0).max(1).optional(),
  maxTokens: z.coerce.number().int().min(1).max(8192).optional(),
})

export type AiTaskRequestBodyPayload = z.infer<typeof AiTaskRequestBody>

export type AiTaskDefinition = {
  id: string
  promptFile: string
  inputSchema: z.ZodTypeAny
  outputSchema: z.ZodTypeAny
  buildInputText: (input: any) => string
  normalizeOutput?: (output: any) => any | null
}

type MarketplaceTaxonomySubcategory = {
  label: string
  details?: string[]
}

type MarketplaceTaxonomyCategory = {
  label: string
  subcategories: MarketplaceTaxonomySubcategory[]
}

type MarketplaceTaxonomySection = {
  label: string
  categories: MarketplaceTaxonomyCategory[]
}

function normalizeMultiline(value: string | null | undefined, fallback = '(none)') {
  const trimmed = (value ?? '').trim()
  return trimmed || fallback
}

function normalizeTaskLabel(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickCanonicalLabel(input: string | null | undefined, options: string[]) {
  const normalizedInput = normalizeTaskLabel(input)
  if (!normalizedInput) return null

  const exact = options.find((option) => normalizeTaskLabel(option) === normalizedInput)
  if (exact) return exact

  const looseMatches = options.filter((option) => {
    const normalizedOption = normalizeTaskLabel(option)
    return normalizedOption.includes(normalizedInput) || normalizedInput.includes(normalizedOption)
  })
  if (looseMatches.length === 1) return looseMatches[0] ?? null

  let bestOption: string | null = null
  let bestScore = 0
  const inputTokens = new Set(normalizedInput.split(' ').filter(Boolean))
  for (const option of options) {
    const optionTokens = new Set(normalizeTaskLabel(option).split(' ').filter(Boolean))
    let overlap = 0
    for (const token of inputTokens) {
      if (optionTokens.has(token)) overlap += 1
    }
    if (overlap > bestScore) {
      bestScore = overlap
      bestOption = option
    }
  }

  return bestScore >= Math.max(1, Math.ceil(inputTokens.size / 2)) ? bestOption : null
}

const MARKETPLACE_TAXONOMY: MarketplaceTaxonomySection[] = [
  {
    label: 'Items',
    categories: [
      {
        label: 'Clothing & Accessories',
        subcategories: [
          { label: "Men's Clothing", details: ['Tops (T Shirts, Polos, Dress Shirts, Hoodies, Sweaters)', 'Outerwear (Jackets, Coats, Blazers, Vests)', 'Bottoms (Jeans, Pants, Shorts, Joggers)', 'Suits & Formalwear (Suits, Tuxedos)', 'Activewear', 'Sleepwear & Loungewear', 'Workwear', 'Swimwear', 'Underwear & Socks'] },
          { label: "Women's Clothing", details: ['Tops (Blouses, Tank Tops, Sweaters)', 'Dresses (Casual, Formal, Maxi, Mini)', 'Skirts', 'Bottoms (Jeans, Leggings, Shorts)', 'Outerwear (Coats, Jackets, Cardigans)', 'Activewear', 'Intimates', 'Maternity', 'Swimwear'] },
          { label: 'Kids Clothing', details: ['Baby (0-12 Months)', 'Toddler (1-3 Years)', 'Kids (4-9 Years)', 'Pre-Teen (10-12 Years)', 'Teen (13-17 Years)'] },
          { label: 'Shoes', details: ["Men's Shoes (Sneakers, Boots, Dress Shoes)", "Women's Shoes (Heels, Flats, Boots)", 'Kids Shoes'] },
          { label: 'Bags & Luggage', details: ['Handbags', 'Backpacks', 'Wallets', 'Travel Bags'] },
          { label: 'Jewellery & Watches', details: ['Necklaces', 'Rings', 'Watches'] },
          { label: 'Fashion Accessories', details: ['Hats', 'Belts', 'Scarves', 'Sunglasses'] },
          { label: 'Costumes' },
          { label: 'Wedding & Formal' },
          { label: 'Uniforms & Workwear' },
          { label: 'Vintage Clothing' },
          { label: 'Plus Size Clothing' },
          { label: 'Seasonal Clothing' },
          { label: 'Multi Item Clothing Lots' },
        ],
      },
      {
        label: 'Home & Living',
        subcategories: [
          { label: 'Furniture', details: ['Living Room', 'Bedroom', 'Dining', 'Office', 'Outdoor Furniture'] },
          { label: 'Home Decor', details: ['Wall Art', 'Mirrors', 'Rugs', 'Curtains'] },
          { label: 'Kitchen & Dining', details: ['Cookware', 'Small Appliances', 'Dishes & Utensils'] },
          { label: 'Bedding & Linens' },
          { label: 'Storage & Organization' },
          { label: 'Lighting' },
        ],
      },
      {
        label: 'Electronics & Technology',
        subcategories: [
          { label: 'Phones', details: ['Smartphones', 'Accessories'] },
          { label: 'Computers', details: ['Desktops', 'Laptops', 'Tablets', 'Parts'] },
          { label: 'Computer Accessories', details: ['Monitors', 'Keyboards', 'Networking'] },
          { label: 'Audio', details: ['Headphones', 'Speakers'] },
          { label: 'TVs & Video' },
          { label: 'Cameras & Camcorders' },
          { label: 'Video Games & Consoles' },
          { label: 'Smart Home Devices' },
        ],
      },
      { label: 'Appliances', subcategories: [{ label: 'Kitchen Appliances' }, { label: 'Laundry Machines' }, { label: 'Small Appliances' }] },
      { label: 'Outdoor & Garden', subcategories: [{ label: 'Patio Furniture' }, { label: 'Gardening Supplies' }, { label: 'BBQ & Outdoor Cooking' }, { label: 'Outdoor Decor' }] },
      { label: 'Tools & Renovation', subcategories: [{ label: 'Tools', details: ['Hand Tools', 'Power Tools'] }, { label: 'Building Materials', details: ['Lumber', 'Flooring', 'Fixtures', 'Paint'] }] },
      { label: 'Sports & Recreation', subcategories: [{ label: 'Fitness Equipment' }, { label: 'Team Sports' }, { label: 'Outdoor Sports' }, { label: 'Bikes' }] },
      { label: 'Toys, Games & Hobbies', subcategories: [{ label: 'Toys' }, { label: 'Board Games' }, { label: 'Hobbies & Crafts' }, { label: 'Models & DIY' }] },
      { label: 'Books & Media', subcategories: [{ label: 'Books' }, { label: 'CDs / DVDs / Blu-ray' }, { label: 'Vinyl' }] },
      { label: 'Musical Instruments', subcategories: [{ label: 'Guitars' }, { label: 'Keyboards' }, { label: 'Drums' }, { label: 'Band Instruments' }] },
      { label: 'Baby & Kids Items', subcategories: [{ label: 'Strollers' }, { label: 'Cribs' }, { label: 'Car Seats' }, { label: 'Toys' }, { label: 'Feeding Supplies' }] },
      { label: 'Health & Wellness', subcategories: [{ label: 'Medical Equipment' }, { label: 'Mobility Aids' }, { label: 'Wellness Products' }] },
      { label: 'Business & Industrial', subcategories: [{ label: 'Equipment' }, { label: 'Supplies' }, { label: 'Inventory' }] },
      { label: 'Tickets & Events', subcategories: [{ label: 'Concerts' }, { label: 'Sports' }, { label: 'Local Events' }] },
      { label: 'Free & Community', subcategories: [{ label: 'Free Items' }, { label: 'Garage Sales' }] },
    ],
  },
  {
    label: 'Vehicles',
    categories: [
      { label: 'Cars & Trucks', subcategories: [{ label: 'Sedans' }, { label: 'SUVs' }, { label: 'Pickup Trucks' }, { label: 'Vans' }, { label: 'Hatchbacks' }] },
      { label: 'Vehicle Parts & Accessories', subcategories: [{ label: 'Tires' }, { label: 'Rims' }, { label: 'Engine Parts' }, { label: 'Interior Parts' }, { label: 'Exterior Parts' }] },
      { label: 'Heavy Equipment', subcategories: [{ label: 'Excavators' }, { label: 'Loaders' }, { label: 'Skid Steers' }] },
      { label: 'Motorcycles', subcategories: [{ label: 'Sport Bikes' }, { label: 'Cruisers' }, { label: 'Dirt Bikes' }] },
      { label: 'ATVs & Snowmobiles', subcategories: [{ label: 'ATVs & Snowmobiles' }] },
      { label: 'RVs & Trailers', subcategories: [{ label: 'Motorhomes' }, { label: 'Travel Trailers' }, { label: 'Utility Trailers' }] },
      { label: 'Boats & Watercraft', subcategories: [{ label: 'Fishing Boats' }, { label: 'Speed Boats' }, { label: 'Jet Skis' }] },
      { label: 'Farming Equipment', subcategories: [{ label: 'Tractors' }, { label: 'Implements' }, { label: 'Attachments' }] },
      { label: 'Classic Cars', subcategories: [{ label: 'Classic Cars' }] },
      { label: 'Automotive Services', subcategories: [{ label: 'Repair' }, { label: 'Detailing' }, { label: 'Inspection' }] },
    ],
  },
]

function normalizeMarketplaceCategoryOutput(output: z.infer<typeof MarketplaceCategoryOutput>) {
  const sectionLabel = pickCanonicalLabel(output.section, MARKETPLACE_TAXONOMY.map((section) => section.label))
  const sectionFromPrompt = sectionLabel ? MARKETPLACE_TAXONOMY.find((entry) => entry.label === sectionLabel) ?? null : null

  const globalCategoryMatches = MARKETPLACE_TAXONOMY.flatMap((section) =>
    section.categories
      .filter((category) => Boolean(pickCanonicalLabel(output.category, [category.label])))
      .map((category) => ({ section, category })),
  )

  let categorySection = sectionFromPrompt
  let category = sectionFromPrompt
    ? (() => {
        const label = pickCanonicalLabel(output.category, sectionFromPrompt.categories.map((entry) => entry.label))
        return label ? sectionFromPrompt.categories.find((entry) => entry.label === label) ?? null : null
      })()
    : null

  if (!category) {
    if (globalCategoryMatches.length !== 1) return null
    categorySection = globalCategoryMatches[0]?.section ?? null
    category = globalCategoryMatches[0]?.category ?? null
  }
  if (!categorySection || !category) return null

  const globalSubcategoryMatches = MARKETPLACE_TAXONOMY.flatMap((section) =>
    section.categories.flatMap((categoryEntry) =>
      categoryEntry.subcategories
        .filter((subcategoryEntry) => Boolean(pickCanonicalLabel(output.subcategory, [subcategoryEntry.label])))
        .map((subcategoryEntry) => ({ section, category: categoryEntry, subcategory: subcategoryEntry })),
    ),
  )

  const subcategoryLabel = pickCanonicalLabel(output.subcategory, category.subcategories.map((subcategoryEntry) => subcategoryEntry.label))
  let subcategory = subcategoryLabel ? category.subcategories.find((entry) => entry.label === subcategoryLabel) ?? null : null

  if (!subcategory) {
    const categoryScopedSubcategoryMatches = globalSubcategoryMatches.filter((entry) => entry.category.label === category.label)
    if (categoryScopedSubcategoryMatches.length !== 1) return null
    categorySection = categoryScopedSubcategoryMatches[0]?.section ?? categorySection
    category = categoryScopedSubcategoryMatches[0]?.category ?? category
    subcategory = categoryScopedSubcategoryMatches[0]?.subcategory ?? null
  }
  if (!subcategory) return null

  let detailLabel: string | null = null
  if (subcategory.details?.length) {
    detailLabel = pickCanonicalLabel(output.detail, subcategory.details)
    if (!detailLabel) return null
  }

  return {
    section: categorySection.label,
    category: category.label,
    subcategory: subcategory.label,
    detail: detailLabel,
  }
}

const AI_TASK_DEFINITIONS: Record<string, AiTaskDefinition> = {
  'marketplace/category': {
    id: 'marketplace/category',
    promptFile: 'marketplace/category.md',
    inputSchema: MarketplaceCategoryInput,
    outputSchema: MarketplaceCategoryOutput,
    normalizeOutput: normalizeMarketplaceCategoryOutput,
    buildInputText: (input: z.infer<typeof MarketplaceCategoryInput>) =>
      [`TITLE: ${input.title.trim()}`, `DESCRIPTION: ${input.description.trim()}`].join('\n'),
  },
  'marketplace/description': {
    id: 'marketplace/description',
    promptFile: 'marketplace/description.md',
    inputSchema: MarketplaceDescriptionInput,
    outputSchema: MarketplaceDescriptionOutput,
    buildInputText: (input: z.infer<typeof MarketplaceDescriptionInput>) =>
      [
        `TITLE: ${input.title.trim()}`,
        `CATEGORY PATH: ${normalizeMultiline(input.categoryPath, '(unknown)')}`,
        `CONDITION: ${normalizeMultiline(input.condition)}`,
        `NOTES: ${normalizeMultiline(input.notes)}`,
      ].join('\n'),
  },
  'jobs/description': {
    id: 'jobs/description',
    promptFile: 'jobs/description.md',
    inputSchema: JobDescriptionInput,
    outputSchema: JobDescriptionOutput,
    buildInputText: (input: z.infer<typeof JobDescriptionInput>) =>
      [
        `TITLE: ${input.title.trim()}`,
        `ORGANIZATION: ${normalizeMultiline(input.organizationName)}`,
        `LOCATION: ${normalizeMultiline(input.location)}`,
        `RESPONSIBILITIES: ${normalizeMultiline(input.responsibilities)}`,
        `REQUIREMENTS: ${normalizeMultiline(input.requirements)}`,
        `NOTES: ${normalizeMultiline(input.notes)}`,
      ].join('\n'),
  },
}

export function listAiTasks() {
  return Object.values(AI_TASK_DEFINITIONS).map((task) => ({ id: task.id, promptFile: task.promptFile }))
}

export function getAiTaskDefinition(taskId: string) {
  return AI_TASK_DEFINITIONS[taskId] ?? null
}

export async function loadAiTaskPrompt(task: AiTaskDefinition) {
  const cached = promptCache.get(task.id)
  if (cached) return cached
  const promptPath = `${TASK_PROMPT_ROOT}${task.promptFile.startsWith('/') ? '' : '/'}${task.promptFile}`
  const content = await fs.readFile(promptPath, 'utf8')
  promptCache.set(task.id, content)
  return content
}

export function parseAiTaskJsonResponse(rawText: string) {
  const trimmed = rawText.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || trimmed
  const objectText = candidate.match(/\{[\s\S]*\}/)?.[0]
  if (!objectText) return null
  try {
    return JSON.parse(objectText)
  } catch {
    return null
  }
}