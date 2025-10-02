// @ts-nocheck
/* global */

export const SLUG_BASE_MAX_LENGTH = 80;
const RANDOM_SUFFIX_LENGTH = 6;

function normalizeTitle(title = '') {
  return title
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase();
}

export function slugifyTitle(title = '') {
  const normalized = normalizeTitle(title);
  const hyphenated = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return hyphenated
    .slice(0, SLUG_BASE_MAX_LENGTH)
    .replace(/-+$/g, '')
    .replace(/^-+/, '');
}

export function randomPostSuffix() {
  return `post-${Math.random().toString(36).slice(2, 2 + RANDOM_SUFFIX_LENGTH)}`;
}

export function composeSlug(base, suffix) {
  if (!base) return suffix;
  if (!suffix) return base;
  if (base.endsWith('-')) {
    return `${base}${suffix}`;
  }
  return `${base}-${suffix}`;
}
