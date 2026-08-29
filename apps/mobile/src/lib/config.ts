/**
 * API origin for the partner app hosting the manage HTTP surface
 * (apps/partner/app/api/manage/*). Overridable per environment:
 * EXPO_PUBLIC_API_URL=https://local.sunbnb.app:3001 for local dev.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://local.sunbnb.app:3001'
