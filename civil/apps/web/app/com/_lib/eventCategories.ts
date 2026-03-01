export const EVENT_CATEGORIES = [
  'Business',
  'Food & Drink',
  'Health',
  'Music',
  'Auto, Boat & Air',
  'Charity & Causes',
  'Community',
  'Family & Education',
  'Fashion',
  'Film & Media',
  'Hobbies',
  'Home & Lifestyle',
  'Performing & Visual Arts',
  'Government',
  'Spirituality',
  'School Activities',
  'Science & Tech',
  'Holidays',
  'Sports & Fitness',
  'Travel & Outdoor',
  'Other',
] as const

export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const DEFAULT_EVENT_CATEGORY: EventCategory = 'Other'
