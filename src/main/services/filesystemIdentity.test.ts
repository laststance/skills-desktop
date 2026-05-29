import { describe, expect, it } from 'vitest'

import type { FilesystemEntryIdentity } from '@/shared/types'

import {
  isReviewedEntryUnchangedIdentity,
  isSameFilesystemEntryIdentity,
} from './filesystemIdentity'

/**
 * These specs lock in the same-path-replacement guard at the identity level so
 * the contract holds on every platform — including CI Linux/ext4, which recycles
 * inode numbers and where the integration tests originally regressed. Building
 * identities by hand (rather than touching a real filesystem) lets us simulate
 * inode reuse, which APFS on the dev machine never produces on its own.
 */
describe('filesystem identity guards for destructive deletes', () => {
  // A reviewed source/local skill directory as captured at scan time.
  const reviewedDirectory: FilesystemEntryIdentity = {
    kind: 'directory',
    dev: 16777233,
    ino: 99,
    size: 96,
    ctimeMs: 1_000,
    mtimeMs: 2_000,
  }

  describe('isReviewedEntryUnchangedIdentity (strict pre-operation gate)', () => {
    it('treats a reused-inode same-path replacement as changed so the wrong folder is not deleted', () => {
      // Arrange: rm+mkdir recycled the inode number, so dev/ino/size/mtime all
      // collide; only the freshly initialized ctime gives the replacement away.
      const recreatedWithSameInode: FilesystemEntryIdentity = {
        kind: 'directory',
        dev: 16777233,
        ino: 99,
        size: 96,
        ctimeMs: 1_500,
        mtimeMs: 2_000,
      }

      // Act
      const isUnchanged = isReviewedEntryUnchangedIdentity(
        recreatedWithSameInode,
        reviewedDirectory,
      )

      // Assert
      expect(isUnchanged).toBe(false)
    })

    it('keeps an untouched reviewed folder deletable when every field matches', () => {
      // Arrange: same object, nothing changed since review.
      const unchanged: FilesystemEntryIdentity = {
        kind: 'directory',
        dev: 16777233,
        ino: 99,
        size: 96,
        ctimeMs: 1_000,
        mtimeMs: 2_000,
      }

      // Act
      const isUnchanged = isReviewedEntryUnchangedIdentity(
        unchanged,
        reviewedDirectory,
      )

      // Assert
      expect(isUnchanged).toBe(true)
    })

    it('rejects a different inode appearing at the reviewed path', () => {
      // Arrange: a genuinely different object now occupies the path.
      const differentInode: FilesystemEntryIdentity = {
        kind: 'directory',
        dev: 16777233,
        ino: 100,
        size: 96,
        ctimeMs: 1_000,
        mtimeMs: 2_000,
      }

      // Act
      const isUnchanged = isReviewedEntryUnchangedIdentity(
        differentInode,
        reviewedDirectory,
      )

      // Assert
      expect(isUnchanged).toBe(false)
    })

    it('rejects when the reviewed directory was replaced by a symlink', () => {
      // Arrange: kind flipped from directory to symlink.
      const symlinkAtSamePath: FilesystemEntryIdentity = {
        kind: 'symlink',
        dev: 16777233,
        ino: 99,
        size: 96,
        ctimeMs: 1_000,
        mtimeMs: 2_000,
      }

      // Act
      const isUnchanged = isReviewedEntryUnchangedIdentity(
        symlinkAtSamePath,
        reviewedDirectory,
      )

      // Assert
      expect(isUnchanged).toBe(false)
    })

    it('rejects a fresh-ctime replacement on a filesystem that reports no inode', () => {
      // Arrange: dev=ino=0 (no inode support) so identity falls back to
      // size+ctime+mtime; a replacement bumps ctime even here.
      const reviewedNoInode: FilesystemEntryIdentity = {
        kind: 'directory',
        dev: 0,
        ino: 0,
        size: 96,
        ctimeMs: 1_000,
        mtimeMs: 2_000,
      }
      const replacedNoInode: FilesystemEntryIdentity = {
        kind: 'directory',
        dev: 0,
        ino: 0,
        size: 96,
        ctimeMs: 1_500,
        mtimeMs: 2_000,
      }

      // Act
      const isUnchanged = isReviewedEntryUnchangedIdentity(
        replacedNoInode,
        reviewedNoInode,
      )

      // Assert
      expect(isUnchanged).toBe(false)
    })
  })

  describe('isSameFilesystemEntryIdentity (rename-stable post-rename check)', () => {
    it('still matches a reused-inode entry whose ctime moved, so our own quarantine rename is not flagged stale', () => {
      // Arrange: rename preserves dev+ino but bumps ctime; the post-rename
      // re-check must ignore ctime or every legitimate delete would fail.
      const renamedSameInode: FilesystemEntryIdentity = {
        kind: 'directory',
        dev: 16777233,
        ino: 99,
        size: 96,
        ctimeMs: 1_500,
        mtimeMs: 2_000,
      }

      // Act
      const isSame = isSameFilesystemEntryIdentity(
        renamedSameInode,
        reviewedDirectory,
      )

      // Assert
      expect(isSame).toBe(true)
    })

    it('rejects a different inode at the reviewed path', () => {
      // Arrange: different object, different inode.
      const differentInode: FilesystemEntryIdentity = {
        kind: 'directory',
        dev: 16777233,
        ino: 100,
        size: 96,
        ctimeMs: 1_000,
        mtimeMs: 2_000,
      }

      // Act
      const isSame = isSameFilesystemEntryIdentity(
        differentInode,
        reviewedDirectory,
      )

      // Assert
      expect(isSame).toBe(false)
    })
  })
})
