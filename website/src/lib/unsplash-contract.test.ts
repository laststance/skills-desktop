import { describe, expect, it } from 'vitest'

import {
  UnsplashDownloadInputSchema,
  UnsplashImageUrlSchema,
  UnsplashPhotoSchema,
  UnsplashSearchInputSchema,
  UnsplashSearchResultSchema,
} from './unsplash-contract'

const photo = {
  id: '5oRIcisKaxU',
  width: 4608,
  height: 3072,
  description: null,
  altDescription: null,
  urls: {
    raw: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?ixid=public-tracking&ixlib=rb-4.1.0',
    small:
      'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?ixid=public-tracking&w=480',
  },
  links: {
    html: 'https://unsplash.com/photos/lake-5oRIcisKaxU?utm_source=skills-desktop&utm_medium=referral',
    downloadLocation:
      'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=public-tracking',
  },
  photographer: {
    name: 'Mike Petrucci',
    username: 'mikepetrucci',
    profileUrl:
      'https://unsplash.com/@mikepetrucci?utm_source=skills-desktop&utm_medium=referral',
  },
}

describe('public Unsplash contract', () => {
  it('preserves direct hotlinks, tracking and nullable descriptions for gallery photos', () => {
    // Arrange / Act
    const result = UnsplashPhotoSchema.parse(photo)
    // Assert
    expect(result).toEqual(photo)
    expect(new URL(result.urls.raw).searchParams.get('ixid')).toBe(
      'public-tracking',
    )
  })

  it.each([
    'not a URL',
    'http://images.unsplash.com/photo-123?ixid=tracking',
    'https://images.unsplash.com.evil.test/photo-123?ixid=tracking',
    'https://secret@images.unsplash.com/photo-123?ixid=tracking',
    'https://images.unsplash.com/photo-123',
    'https://images.unsplash.com/photo-123?ixid=',
    'https://images.unsplash.com/other/file?ixid=tracking',
    'file:///Users/me/photo.jpg',
  ])(
    'rejects an invalid image location without throwing outside validation: %s',
    (imageUrl) => {
      // Arrange / Act
      const result = UnsplashImageUrlSchema.safeParse(imageUrl)
      // Assert
      expect(result.success).toBe(false)
    },
  )

  it.each([
    'not a URL',
    'https://api.unsplash.com.evil.test/photos/5oRIcisKaxU/download',
    'https://api.unsplash.com:444/photos/5oRIcisKaxU/download',
    'https://user:secret@api.unsplash.com/photos/5oRIcisKaxU/download',
    'https://api.unsplash.com/photos/other/download',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download/extra',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download?redirect=https://evil.test',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download?client_id=secret',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=a&ixid=b',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download#other',
  ])(
    'blocks credential forwarding to an invalid download location: %s',
    (downloadLocation) => {
      // Arrange / Act
      const result = UnsplashDownloadInputSchema.safeParse({
        photoId: '5oRIcisKaxU',
        downloadLocation,
      })
      // Assert
      expect(result.success).toBe(false)
    },
  )

  it('accepts only the selected photo endpoint and preserves its tracking token', () => {
    // Arrange
    const input = {
      photoId: '5oRIcisKaxU',
      downloadLocation:
        'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=public-tracking',
    }
    // Act / Assert
    expect(UnsplashDownloadInputSchema.parse(input)).toEqual(input)
  })

  it('rejects mismatched photo metadata and unsafe credit pages', () => {
    // Arrange / Act / Assert
    expect(
      UnsplashPhotoSchema.safeParse({ ...photo, id: 'another-photo' }).success,
    ).toBe(false)
    expect(
      UnsplashPhotoSchema.safeParse({
        ...photo,
        photographer: {
          ...photo.photographer,
          profileUrl: 'https://evil.test/@mike',
        },
      }).success,
    ).toBe(false)
  })

  it('trims a valid search without inventing a page or expanding its result bound', () => {
    // Arrange / Act
    const result = UnsplashSearchInputSchema.parse({
      query: '  nature landscape  ',
      page: 1,
    })
    // Assert
    expect(result).toEqual({ query: 'nature landscape', page: 1 })
  })

  it.each([
    { query: '', page: 1 },
    { query: '  ', page: 1 },
    { query: 'x'.repeat(101), page: 1 },
    { query: 'nature', page: 0 },
    { query: 'nature', page: 1001 },
    { query: 'nature', page: 1.5 },
    { query: 'nature', page: 1, url: 'https://evil.test' },
  ])('rejects invalid or unbounded search input: %j', (input) => {
    // Arrange / Act
    const result = UnsplashSearchInputSchema.safeParse(input)
    // Assert
    expect(result.success).toBe(false)
  })

  it('allows an empty end page but rejects oversized upstream result pages', () => {
    // Arrange / Act / Assert
    expect(
      UnsplashSearchResultSchema.parse({ items: [], nextPage: null }),
    ).toEqual({ items: [], nextPage: null })
    expect(
      UnsplashSearchResultSchema.safeParse({
        items: Array.from({ length: 31 }, () => photo),
        nextPage: 2,
      }).success,
    ).toBe(false)
  })
})
