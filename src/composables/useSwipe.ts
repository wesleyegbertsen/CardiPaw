import { ref, computed, type Ref } from 'vue'

export function useSwipe(
  containerRef: Ref<HTMLElement | null>,
  tabIndex: Ref<number>,
  tabCount: number,
  onComplete: (newIndex: number) => void,
) {
  const swipeDeltaX = ref(0)
  const isSwipeActive = ref(false)
  let _startX = 0
  let _startY = 0
  let _dir: 'h' | 'v' | null = null

  function onTouchStart(e: TouchEvent) {
    _startX = e.touches[0].clientX
    _startY = e.touches[0].clientY
    swipeDeltaX.value = 0
    isSwipeActive.value = false
    _dir = null
  }

  function onTouchMove(e: TouchEvent) {
    const dx = e.touches[0].clientX - _startX
    const dy = e.touches[0].clientY - _startY
    if (!_dir) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) _dir = 'h'
      else if (Math.abs(dy) > 6) _dir = 'v'
    }
    if (_dir !== 'h') return
    e.preventDefault()
    isSwipeActive.value = true
    const idx = tabIndex.value
    const atEdge = (idx === 0 && dx > 0) || (idx === tabCount - 1 && dx < 0)
    swipeDeltaX.value = atEdge ? dx * 0.25 : dx
  }

  function onTouchEnd() {
    if (_dir !== 'h') {
      swipeDeltaX.value = 0
      isSwipeActive.value = false
      return
    }
    const w = containerRef.value?.clientWidth ?? 320
    const threshold = Math.min(w * 0.3, 120)
    const idx = tabIndex.value
    if (swipeDeltaX.value < -threshold && idx < tabCount - 1) onComplete(idx + 1)
    else if (swipeDeltaX.value > threshold && idx > 0) onComplete(idx - 1)
    swipeDeltaX.value = 0
    isSwipeActive.value = false
    _dir = null
  }

  const sliderStyle = computed(() => {
    const base = -(tabIndex.value * (100 / tabCount))
    if (isSwipeActive.value) {
      return { transform: `translateX(calc(${base}% + ${swipeDeltaX.value}px))`, transition: 'none' }
    }
    return { transform: `translateX(${base}%)`, transition: 'transform 0.32s cubic-bezier(0.25, 1, 0.5, 1)' }
  })

  return { swipeDeltaX, isSwipeActive, sliderStyle, onTouchStart, onTouchMove, onTouchEnd }
}
