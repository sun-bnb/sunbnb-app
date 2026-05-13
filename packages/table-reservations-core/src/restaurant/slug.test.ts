import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Chiringuito El Sol')).toBe('chiringuito-el-sol')
  })

  it('strips accents', () => {
    expect(slugify('Café Niña — Jalón')).toBe('cafe-nina-jalon')
  })

  it('collapses runs of non-alphanumerics', () => {
    expect(slugify('a!!!b  c')).toBe('a-b-c')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  ---abc---  ')).toBe('abc')
  })

  it('falls back for empty or unusable input', () => {
    expect(slugify('')).toBe('restaurant')
    expect(slugify('!!!')).toBe('restaurant')
  })

  it('caps length at 64 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long).length).toBe(64)
  })
})
