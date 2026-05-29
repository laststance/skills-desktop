import { describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import { useCycleEffect } from './useCycleEffect'
import { useInitialEffect } from './useInitialEffect'
import { useRenderEffect } from './useRenderEffect'
import { useUnmountEffect } from './useUnmountEffect'
import { useUpdateEffect } from './useUpdateEffect'

describe('lifecycle effect hooks', () => {
  describe('useInitialEffect', () => {
    it('runs the effect once on mount and never again on re-render', async () => {
      // Arrange
      const effect = vi.fn()
      // Act
      const { rerender } = await renderHook(() => useInitialEffect(effect))
      // Assert
      expect(effect).toHaveBeenCalledOnce()

      // Act
      await rerender()
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledOnce()
    })
  })

  describe('useUpdateEffect', () => {
    it('skips the mount run and fires on every re-render when deps are omitted', async () => {
      // Arrange
      const effect = vi.fn()
      // Act
      const { rerender } = await renderHook(() => useUpdateEffect(effect))
      // Assert
      expect(effect).not.toHaveBeenCalled()

      // Act
      await rerender()
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledTimes(2)
    })

    it('skips the mount run and fires only when a dependency changes', async () => {
      // Arrange
      const effect = vi.fn()
      let value = 0
      // Act
      const { rerender } = await renderHook(() =>
        useUpdateEffect(effect, [value]),
      )
      // Assert
      expect(effect).not.toHaveBeenCalled()

      // Act
      await rerender()
      // Assert
      expect(effect).not.toHaveBeenCalled()

      // Act
      value = 1
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledOnce()
    })

    it('rejects an empty dependency list at compile time and never runs the effect', async () => {
      // Arrange
      const effect = vi.fn()
      // Act
      await renderHook(() =>
        // @ts-expect-error - omit deps for every update, or pass non-empty deps.
        useUpdateEffect(effect, []),
      )
      // Assert
      expect(effect).not.toHaveBeenCalled()
    })
  })

  describe('useUnmountEffect', () => {
    it('runs the callback only when the component unmounts', async () => {
      // Arrange
      const callback = vi.fn()
      const { unmount } = await renderHook(() => useUnmountEffect(callback))
      // Assert
      expect(callback).not.toHaveBeenCalled()

      // Act
      unmount()
      // Assert
      expect(callback).toHaveBeenCalledOnce()
    })

    it('runs the latest callback on unmount, not the one captured at mount', async () => {
      // Arrange
      const initialCallback = vi.fn()
      const latestCallback = vi.fn()
      let callback = initialCallback
      const { rerender, unmount } = await renderHook(() =>
        useUnmountEffect(callback),
      )

      // Act
      callback = latestCallback
      await rerender()
      unmount()

      // Assert
      expect(initialCallback).not.toHaveBeenCalled()
      expect(latestCallback).toHaveBeenCalledOnce()
    })
  })

  describe('useRenderEffect', () => {
    it('runs the effect on mount and on every re-render when deps are omitted', async () => {
      // Arrange
      const effect = vi.fn()
      const { rerender } = await renderHook(() => useRenderEffect(effect))
      // Assert
      expect(effect).toHaveBeenCalledTimes(1)

      // Act
      await rerender()
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledTimes(3)
    })

    it('runs the effect on mount and only when a non-empty dependency changes', async () => {
      // Arrange
      const effect = vi.fn()
      let value = 0
      const { rerender } = await renderHook(() =>
        useRenderEffect(effect, [value]),
      )
      // Assert
      expect(effect).toHaveBeenCalledTimes(1)

      // Act
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledTimes(1)

      // Act
      value = 1
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledTimes(2)
    })

    it('rejects an empty dependency list at compile time but still runs once on mount', async () => {
      // Arrange
      const effect = vi.fn()
      // Act
      await renderHook(() =>
        // @ts-expect-error - useInitialEffect owns mount-only `[]` semantics.
        useRenderEffect(effect, []),
      )
      // Assert
      expect(effect).toHaveBeenCalledOnce()
    })
  })

  describe('useCycleEffect', () => {
    it('behaves like useEffect with empty deps by running once on mount only', async () => {
      // Arrange
      const effect = vi.fn()
      const { rerender } = await renderHook(() => useCycleEffect(effect, []))
      // Assert
      expect(effect).toHaveBeenCalledOnce()

      // Act
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledOnce()
    })

    it('behaves like useEffect with non-empty deps by re-running when a dependency changes', async () => {
      // Arrange
      const effect = vi.fn()
      let value = 0
      const { rerender } = await renderHook(() =>
        useCycleEffect(effect, [value]),
      )
      // Assert
      expect(effect).toHaveBeenCalledTimes(1)

      // Act
      value = 1
      await rerender()
      // Assert
      expect(effect).toHaveBeenCalledTimes(2)
    })
  })
})
