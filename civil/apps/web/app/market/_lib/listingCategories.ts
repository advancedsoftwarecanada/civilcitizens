export type MarketListingSubcategory = {
  label: string
  details?: MarketListingSubcategoryDetail[]
}

export type MarketListingSubcategoryDetail = {
  label: string
}

export type MarketListingCategory = {
  label: string
  subcategories: MarketListingSubcategory[]
}

export type MarketListingSection = {
  label: string
  categories: MarketListingCategory[]
}

const detail = (label: string): MarketListingSubcategoryDetail => ({ label })
const leaf = (label: string): MarketListingSubcategory => ({ label })
const branch = (label: string, details: string[]): MarketListingSubcategory => ({
  label,
  details: details.map(detail),
})
const category = (label: string, subcategories: MarketListingSubcategory[]): MarketListingCategory => ({ label, subcategories })

function normalizeListingLabel(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

export const MARKET_LISTING_SECTIONS: MarketListingSection[] = [
  {
    label: 'Items',
    categories: [
      category('Clothing & Accessories', [
        branch("Men's Clothing", [
          'Tops (T Shirts, Polos, Dress Shirts, Hoodies, Sweaters)',
          'Outerwear (Jackets, Coats, Blazers, Vests)',
          'Bottoms (Jeans, Pants, Shorts, Joggers)',
          'Suits & Formalwear (Suits, Tuxedos)',
          'Activewear',
          'Sleepwear & Loungewear',
          'Workwear',
          'Swimwear',
          'Underwear & Socks',
        ]),
        branch("Women's Clothing", [
          'Tops (Blouses, Tank Tops, Sweaters)',
          'Dresses (Casual, Formal, Maxi, Mini)',
          'Skirts',
          'Bottoms (Jeans, Leggings, Shorts)',
          'Outerwear (Coats, Jackets, Cardigans)',
          'Activewear',
          'Intimates',
          'Maternity',
          'Swimwear',
        ]),
        branch('Kids Clothing', [
          'Baby (0-12 Months)',
          'Toddler (1-3 Years)',
          'Kids (4-9 Years)',
          'Pre-Teen (10-12 Years)',
          'Teen (13-17 Years)',
        ]),
        branch('Shoes', [
          "Men's Shoes (Sneakers, Boots, Dress Shoes)",
          "Women's Shoes (Heels, Flats, Boots)",
          'Kids Shoes',
        ]),
        branch('Bags & Luggage', ['Handbags', 'Backpacks', 'Wallets', 'Travel Bags']),
        branch('Jewellery & Watches', ['Necklaces', 'Rings', 'Watches']),
        branch('Fashion Accessories', ['Hats', 'Belts', 'Scarves', 'Sunglasses']),
        leaf('Costumes'),
        leaf('Wedding & Formal'),
        leaf('Uniforms & Workwear'),
        leaf('Vintage Clothing'),
        leaf('Plus Size Clothing'),
        leaf('Seasonal Clothing'),
        leaf('Multi Item Clothing Lots'),
      ]),
      category('Home & Living', [
        branch('Furniture', ['Living Room', 'Bedroom', 'Dining', 'Office', 'Outdoor Furniture']),
        branch('Home Decor', ['Wall Art', 'Mirrors', 'Rugs', 'Curtains']),
        branch('Kitchen & Dining', ['Cookware', 'Small Appliances', 'Dishes & Utensils']),
        leaf('Bedding & Linens'),
        leaf('Storage & Organization'),
        leaf('Lighting'),
      ]),
      category('Electronics & Technology', [
        branch('Phones', ['Smartphones', 'Accessories']),
        branch('Computers', ['Desktops', 'Laptops', 'Tablets', 'Parts']),
        branch('Computer Accessories', ['Monitors', 'Keyboards', 'Networking']),
        branch('Audio', ['Headphones', 'Speakers']),
        leaf('TVs & Video'),
        leaf('Cameras & Camcorders'),
        leaf('Video Games & Consoles'),
        leaf('Smart Home Devices'),
      ]),
      category('Appliances', [
        leaf('Kitchen Appliances'),
        leaf('Laundry Machines'),
        leaf('Small Appliances'),
      ]),
      category('Outdoor & Garden', [
        leaf('Patio Furniture'),
        leaf('Gardening Supplies'),
        leaf('BBQ & Outdoor Cooking'),
        leaf('Outdoor Decor'),
      ]),
      category('Tools & Renovation', [
        branch('Tools', ['Hand Tools', 'Power Tools']),
        branch('Building Materials', ['Lumber', 'Flooring', 'Fixtures', 'Paint']),
      ]),
      category('Sports & Recreation', [
        leaf('Fitness Equipment'),
        leaf('Team Sports'),
        leaf('Outdoor Sports'),
        leaf('Bikes'),
      ]),
      category('Toys, Games & Hobbies', [
        leaf('Toys'),
        leaf('Board Games'),
        leaf('Hobbies & Crafts'),
        leaf('Models & DIY'),
      ]),
      category('Books & Media', [leaf('Books'), leaf('CDs / DVDs / Blu-ray'), leaf('Vinyl')]),
      category('Musical Instruments', [leaf('Guitars'), leaf('Keyboards'), leaf('Drums'), leaf('Band Instruments')]),
      category('Baby & Kids Items', [leaf('Strollers'), leaf('Cribs'), leaf('Car Seats'), leaf('Toys'), leaf('Feeding Supplies')]),
      category('Health & Wellness', [leaf('Medical Equipment'), leaf('Mobility Aids'), leaf('Wellness Products')]),
      category('Business & Industrial', [leaf('Equipment'), leaf('Supplies'), leaf('Inventory')]),
      category('Tickets & Events', [leaf('Concerts'), leaf('Sports'), leaf('Local Events')]),
      category('Free & Community', [leaf('Free Items'), leaf('Garage Sales')]),
    ],
  },
  {
    label: 'Vehicles',
    categories: [
      category('Cars & Trucks', [leaf('Sedans'), leaf('SUVs'), leaf('Pickup Trucks'), leaf('Vans'), leaf('Hatchbacks')]),
      category('Vehicle Parts & Accessories', [leaf('Tires'), leaf('Rims'), leaf('Engine Parts'), leaf('Interior Parts'), leaf('Exterior Parts')]),
      category('Heavy Equipment', [leaf('Excavators'), leaf('Loaders'), leaf('Skid Steers')]),
      category('Motorcycles', [leaf('Sport Bikes'), leaf('Cruisers'), leaf('Dirt Bikes')]),
      category('ATVs & Snowmobiles', [leaf('ATVs & Snowmobiles')]),
      category('RVs & Trailers', [leaf('Motorhomes'), leaf('Travel Trailers'), leaf('Utility Trailers')]),
      category('Boats & Watercraft', [leaf('Fishing Boats'), leaf('Speed Boats'), leaf('Jet Skis')]),
      category('Farming Equipment', [leaf('Tractors'), leaf('Implements'), leaf('Attachments')]),
      category('Classic Cars', [leaf('Classic Cars')]),
      category('Automotive Services', [leaf('Repair'), leaf('Detailing'), leaf('Inspection')]),
    ],
  },
  {
    label: 'Food & Grocery',
    categories: [
      category('Raw Ingredients', [
        leaf('Meat'),
        leaf('Poultry'),
        leaf('Fish & Seafood'),
        leaf('Dairy & Eggs'),
        leaf('Fruits'),
        leaf('Vegetables'),
        leaf('Grains & Flour'),
        leaf('Herbs & Spices'),
        leaf('Oils & Sauces'),
      ]),
      category('Prepared Food', [
        leaf('Home Cooked Meals'),
        leaf('Ready To Eat Meals'),
        leaf('Baked Goods'),
        leaf('Catering Trays'),
        leaf('Restaurant Takeout'),
        leaf('Preserves (Jams, Pickles)'),
      ]),
      category('Frozen Foods', [leaf('Frozen Meat'), leaf('Frozen Meals'), leaf('Frozen Vegetables'), leaf('Frozen Desserts')]),
      category('Beverages', [leaf('Juices'), leaf('Coffee & Tea'), leaf('Soft Drinks'), leaf('Homemade Drinks')]),
      category('Bulk & Farm Direct', [leaf('Farm Produce Boxes'), leaf('Bulk Meat Orders'), leaf('Wholesale Produce')]),
    ],
  },
]

export function getMarketListingSection(sectionLabel: string | null | undefined) {
  const normalizedSection = normalizeListingLabel(sectionLabel)
  return MARKET_LISTING_SECTIONS.find((section) => normalizeListingLabel(section.label) === normalizedSection) ?? null
}

export function getMarketListingCategory(sectionLabel: string | null | undefined, categoryLabel: string | null | undefined) {
  const section = getMarketListingSection(sectionLabel)
  if (!section) return null
  const normalizedCategory = normalizeListingLabel(categoryLabel)
  return section.categories.find((category) => normalizeListingLabel(category.label) === normalizedCategory) ?? null
}

export function getMarketListingSubcategory(
  sectionLabel: string | null | undefined,
  categoryLabel: string | null | undefined,
  subcategoryLabel: string | null | undefined,
) {
  const category = getMarketListingCategory(sectionLabel, categoryLabel)
  if (!category) return null
  const normalizedSubcategory = normalizeListingLabel(subcategoryLabel)
  return category.subcategories.find((subcategory) => normalizeListingLabel(subcategory.label) === normalizedSubcategory) ?? null
}