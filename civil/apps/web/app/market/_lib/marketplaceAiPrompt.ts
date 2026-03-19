import { MARKET_LISTING_SECTIONS } from './listingCategories'

type BuildMarketplaceClassifierPromptArgs = {
  title: string
  description: string
}

function renderMarketplaceTaxonomy() {
  return MARKET_LISTING_SECTIONS.map((section) => {
    const categories = section.categories
      .map((category) => {
        const subcategories = category.subcategories
          .map((subcategory) => {
            if (!subcategory.details?.length) {
              return `    - ${subcategory.label}`
            }

            const details = subcategory.details.map((detail) => `      - ${detail.label}`).join('\n')
            return [`    - ${subcategory.label}`, details].join('\n')
          })
          .join('\n')

        return [`  - ${category.label}`, subcategories].join('\n')
      })
      .join('\n')

    return [`- ${section.label}`, categories].join('\n')
  }).join('\n')
}

export const MARKETPLACE_AI_SYSTEM_PROMPT =
  'You classify marketplace listings into the provided taxonomy. You do not search listings. You do not answer conversationally. You return JSON only.'

export const MARKETPLACE_AI_TAXONOMY_CACHE = renderMarketplaceTaxonomy()

export function buildMarketplaceClassifierPrompt({ title, description }: BuildMarketplaceClassifierPromptArgs) {
  return [
    'You are tasked with taking the TITLE and DESCRIPTION of this item and from it, determining the Section, Category, Subcategory and Detail.',
    '',
    'Use only the taxonomy below.',
    'Return a JSON response only.',
    'Use this exact shape: {"section":"...","category":"...","subcategory":"...","detail":null}',
    'If the chosen subcategory has a valid detail, set detail to that exact label.',
    'If the chosen subcategory has no detail layer, set detail to null.',
    'Do not include markdown fences.',
    'Do not explain your reasoning.',
    '',
    'Marketplace taxonomy:',
    MARKETPLACE_AI_TAXONOMY_CACHE,
    '',
    `TITLE: ${title || '(empty)'}`,
    `DESCRIPTION: ${description || '(empty)'}`,
  ].join('\n')
}