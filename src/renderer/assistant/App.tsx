import { MotionConfig } from 'motion/react'
import { FloatingWindow } from './components/FloatingWindow'

export function App() {
  return (
    // Honours the macOS "Reduce motion" setting for every animation.
    <MotionConfig reducedMotion="user">
      <FloatingWindow />
    </MotionConfig>
  )
}
