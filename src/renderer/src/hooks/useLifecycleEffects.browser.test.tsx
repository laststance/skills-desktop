import { describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import { useCycleEffect } from './useCycleEffect'
import { useInitialEffect } from './useInitialEffect'
import { useRenderEffect } from './useRenderEffect'
import { useUnmountEffect } from './useUnmountEffect'
import { useUpdateEffect } from './useUpdateEffect'

describe('lifecycle effect hooks', () => {
  describe('useInitialEffect', () => {
    it('runs on mount only', async () => {
      const effect = vi.fn()
      const { rerender } = await renderHook(() => useInitialEffect(effect))

      expect(effect).toHaveBeenCalledOnce()
      await rerender()
      await rerender()

      expect(effect).toHaveBeenCalledOnce()
    })
  })

  describe('useUpdateEffect', () => {
    it('skips mount and runs after every re-render when deps are omitted', async () => {
      const effect = vi.fn()
      const { rerender } = await renderHook(() => useUpdateEffect(effect))

      expect(effect).not.toHaveBeenCalled()
      await rerender()
      await rerender()

      expect(effect).toHaveBeenCalledTimes(2)
    })

    it('runs after a dependency changes post-mount', async () => {
      const effect = vi.fn()
      let value = 0
      const { rerender } = await renderHook(() =>
        useUpdateEffect(effect, [value]),
      )

      expect(effect).not.toHaveBeenCalled()
      await rerender()
      expect(effect).not.toHaveBeenCalled()

      value = 1
      await rerender()
      expect(effect).toHaveBeenCalledOnce()
    })

    it('rejects empty dependency lists at the type level', async () => {
      const effect = vi.fn()
      await renderHook(() =>
        // @ts-expect-error - omit deps for every update, or pass non-empty deps.
        useUpdateEffect(effect, []),
      )

      expect(effect).not.toHaveBeenCalled()
    })
  })

  describe('useUnmountEffect', () => {
    it('runs only on unmount', async () => {
      const callback = vi.fn()
      const { unmount } = await renderHook(() => useUnmountEffect(callback))

      expect(callback).not.toHaveBeenCalled()
      unmount()

      expect(callback).toHaveBeenCalledOnce()
    })

    it('uses the latest callback when unmounting after re-render', async () => {
      const initialCallback = vi.fn()
      const latestCallback = vi.fn()
      let callback = initialCallback
      const { rerender, unmount } = await renderHook(() =>
        useUnmountEffect(callback),
      )

      callback = latestCallback
      await rerender()
      unmount()

      expect(initialCallback).not.toHaveBeenCalled()
      expect(latestCallback).toHaveBeenCalledOnce()
    })
  })

  describe('useRenderEffect', () => {
    it('runs on every render when deps are omitted', async () => {
      const effect = vi.fn()
      const { rerender } = await renderHook(() => useRenderEffect(effect))

      expect(effect).toHaveBeenCalledTimes(1)
      await rerender()
      await rerender()

      expect(effect).toHaveBeenCalledTimes(3)
    })

    it('runs on mount and non-empty dependency changes', async () => {
      const effect = vi.fn()
      let value = 0
      const { rerender } = await renderHook(() =>
        useRenderEffect(effect, [value]),
      )

      expect(effect).toHaveBeenCalledTimes(1)
      await rerender()
      expect(effect).toHaveBeenCalledTimes(1)

      value = 1
      await rerender()
      expect(effect).toHaveBeenCalledTimes(2)
    })

    it('rejects empty dependency lists at the type level', async () => {
      const effect = vi.fn()
      await renderHook(() =>
        // @ts-expect-error - useInitialEffect owns mount-only `[]` semantics.
        useRenderEffect(effect, []),
      )

      expect(effect).toHaveBeenCalledOnce()
    })
  })

  describe('useCycleEffect', () => {
    it('matches useEffect with empty deps', async () => {
      const effect = vi.fn()
      const { rerender } = await renderHook(() => useCycleEffect(effect, []))

      expect(effect).toHaveBeenCalledOnce()
      await rerender()

      expect(effect).toHaveBeenCalledOnce()
    })

    it('matches useEffect with non-empty deps', async () => {
      const effect = vi.fn()
      let value = 0
      const { rerender } = await renderHook(() =>
        useCycleEffect(effect, [value]),
      )

      expect(effect).toHaveBeenCalledTimes(1)
      value = 1
      await rerender()

      expect(effect).toHaveBeenCalledTimes(2)
    })
  })
})
