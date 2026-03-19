export type MarketListingSubcategory = {
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

const subcategories = (labels: string[]): MarketListingSubcategory[] => labels.map((label) => ({ label }))

export const MARKET_LISTING_SECTIONS: MarketListingSection[] = [
  {
    label: 'Items',
    categories: [
      { label: 'Arts & Collectibles', subcategories: subcategories(['Antiques', 'Art', 'Collectibles', 'Coins & Stamps', 'Memorabilia', 'Other']) },
      { label: 'Clothing & Accessories', subcategories: subcategories(["Men's Clothing", "Women's Clothing", 'Tops & Outerwear', 'Dresses & Skirts', 'Bottoms', 'Maternity', 'Other']) },
      { label: 'Kids & Youth Clothing', subcategories: subcategories(['Shoes', "Men's Shoes", "Women's Shoes", 'Bags & Wallets', 'Costumes', 'Wedding Apparel', 'Multi-item Bundles', 'Other']) },
      { label: 'Home – Indoor', subcategories: subcategories(['Home Decor', 'Kitchen & Dining', 'Bedding & Linens', 'Storage & Organization', 'Lighting', 'Other']) },
      { label: 'Furniture', subcategories: subcategories(['Living Room', 'Bedroom', 'Dining Room', 'Office Furniture', 'Outdoor Furniture', 'Other']) },
      { label: 'Electronics', subcategories: subcategories(['General Electronics', 'Gadgets', 'Smart Home Devices', 'Other']) },
      { label: 'Computers', subcategories: subcategories(['Desktop Computers', 'Laptops', 'Tablets', 'Computer Parts', 'Other']) },
      { label: 'Computer Accessories', subcategories: subcategories(['Keyboards & Mice', 'Monitors', 'Networking Equipment', 'Storage Devices', 'Other']) },
      { label: 'Phones', subcategories: subcategories(['Smartphones', 'Phone Accessories', 'Other']) },
      { label: 'Audio', subcategories: subcategories(['Headphones', 'Speakers', 'Audio Equipment', 'Other']) },
      { label: 'TVs & Video', subcategories: subcategories(['Televisions', 'Streaming Devices', 'Projectors', 'Other']) },
      { label: 'Cameras & Camcorders', subcategories: subcategories(['Cameras', 'Lenses', 'Accessories', 'Other']) },
      { label: 'Video Games & Consoles', subcategories: subcategories(['Consoles', 'Games', 'Accessories', 'Other']) },
      { label: 'Home Appliances', subcategories: subcategories(['Kitchen Appliances', 'Laundry Appliances', 'Small Appliances', 'Other']) },
      { label: 'Home – Outdoor & Garden', subcategories: subcategories(['Patio & Outdoor Living', 'Gardening Supplies', 'Tools & Equipment', 'BBQs & Outdoor Cooking', 'Other']) },
      { label: 'Tools', subcategories: subcategories(['Hand Tools', 'Power Tools', 'Tool Storage', 'Other']) },
      { label: 'Home Renovation Materials', subcategories: subcategories(['Flooring', 'Lumber', 'Fixtures', 'Paint & Supplies', 'Other']) },
      { label: 'Sporting Goods & Exercise', subcategories: subcategories(['Fitness Equipment', 'Team Sports', 'Outdoor Sports', 'Other']) },
      { label: 'Bikes', subcategories: subcategories(['Road Bikes', 'Mountain Bikes', 'Kids Bikes', 'Accessories', 'Other']) },
      { label: 'Hobbies & Crafts', subcategories: subcategories(['Craft Supplies', 'Models & Kits', 'DIY Materials', 'Other']) },
      { label: 'Toys & Games', subcategories: subcategories(['Board Games', 'Educational Toys', 'Outdoor Toys', 'Other']) },
      { label: 'Books', subcategories: subcategories(['Fiction', 'Non-fiction', 'Educational', 'Comics', 'Other']) },
      { label: 'Music / Media', subcategories: subcategories(['CDs', 'DVDs', 'Blu-ray', 'Vinyl', 'Other']) },
      { label: 'Musical Instruments', subcategories: subcategories(['Guitars', 'Keyboards', 'Drums', 'Band Instruments', 'Other']) },
      { label: 'Jewellery & Watches', subcategories: subcategories(['Watches', 'Necklaces', 'Rings', 'Bracelets', 'Other']) },
      { label: 'Baby Items', subcategories: subcategories(['Strollers', 'Cribs', 'Clothing', 'Toys', 'Other']) },
      { label: 'Health & Special Needs', subcategories: subcategories(['Mobility Equipment', 'Medical Supplies', 'Wellness Products', 'Other']) },
      { label: 'Bags & Luggage', subcategories: subcategories(['Suitcases', 'Travel Bags', 'Backpacks', 'Other']) },
      { label: 'Business & Industrial', subcategories: subcategories(['Equipment', 'Inventory', 'Supplies', 'Other']) },
      { label: 'Tickets', subcategories: subcategories(['Events', 'Sports', 'Concerts', 'Other']) },
      { label: 'Free Stuff', subcategories: subcategories(['Everything Free', 'Garage Sales', 'Listings', 'Other']) },
      { label: 'Miscellaneous', subcategories: subcategories(['Miscellaneous']) },
    ],
  },
  {
    label: 'Services',
    categories: [
      { label: 'Skilled Trades', subcategories: subcategories(['Electrician', 'Plumbing', 'Carpentry', 'HVAC', 'Roofing', 'Other']) },
      { label: 'Cleaning Services', subcategories: subcategories(['Residential Cleaning', 'Commercial Cleaning', 'Specialty Cleaning']) },
      { label: 'Health & Beauty', subcategories: subcategories(['Hair Services', 'Spa Services', 'Personal Care']) },
      { label: 'Tutors & Education', subcategories: subcategories(['Academic Tutoring', 'Language Lessons', 'Test Prep']) },
      { label: 'Moving & Storage', subcategories: subcategories(['Moving Services', 'Storage Solutions']) },
      { label: 'Financial & Legal', subcategories: subcategories(['Accounting', 'Legal Services', 'Tax Services']) },
      { label: 'Entertainment', subcategories: subcategories(['Event Entertainment', 'DJs', 'Performers']) },
      { label: 'Photography & Video', subcategories: subcategories(['Photography', 'Videography', 'Editing']) },
      { label: 'Music Lessons', subcategories: subcategories(['Instrument Lessons', 'Vocal Coaching']) },
      { label: 'Fitness & Personal Training', subcategories: subcategories(['Personal Training', 'Coaching']) },
      { label: 'Wedding Services', subcategories: subcategories(['Planning', 'Photography', 'Catering']) },
      { label: 'Childcare', subcategories: subcategories(['Babysitting', 'Daycare']) },
      { label: 'Food & Catering', subcategories: subcategories(['Catering', 'Private Chef']) },
      { label: 'Travel & Vacations', subcategories: subcategories(['Travel Planning', 'Tours']) },
      { label: 'Other Services', subcategories: subcategories(['Miscellaneous']) },
    ],
  },
  {
    label: 'Cars & Vehicles',
    categories: [
      { label: 'Cars & Trucks', subcategories: subcategories(['Sedans', 'SUVs', 'Trucks', 'Vans']) },
      { label: 'Vehicle Parts & Accessories', subcategories: subcategories(['Tires', 'Parts', 'Accessories']) },
      { label: 'Heavy Equipment', subcategories: subcategories(['Construction Equipment', 'Industrial Vehicles']) },
      { label: 'ATVs & Snowmobiles', subcategories: subcategories(['ATVs', 'Snowmobiles']) },
      { label: 'RVs, Campers & Trailers', subcategories: subcategories(['RVs', 'Campers', 'Utility Trailers']) },
      { label: 'Motorcycles', subcategories: subcategories(['Street Bikes', 'Dirt Bikes', 'Cruisers']) },
      { label: 'Boats & Watercraft', subcategories: subcategories(['Boats', 'Jet Skis', 'Accessories']) },
      { label: 'Farming Equipment', subcategories: subcategories(['Tractors', 'Implements', 'Attachments']) },
      { label: 'Classic Cars', subcategories: subcategories(['Vintage Vehicles']) },
      { label: 'Automotive Services', subcategories: subcategories(['Repairs', 'Detailing', 'Inspections']) },
      { label: 'Other Vehicles', subcategories: subcategories(['Miscellaneous']) },
    ],
  },
]

export function getMarketListingSection(sectionLabel: string | null | undefined) {
  return MARKET_LISTING_SECTIONS.find((section) => section.label === (sectionLabel ?? '').trim()) ?? null
}

export function getMarketListingCategory(sectionLabel: string | null | undefined, categoryLabel: string | null | undefined) {
  const section = getMarketListingSection(sectionLabel)
  if (!section) return null
  return section.categories.find((category) => category.label === (categoryLabel ?? '').trim()) ?? null
}