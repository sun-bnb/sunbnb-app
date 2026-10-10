// Bridge for @react-three/fiber 8 under @types/react 19. Fiber 8 registers its
// <mesh>/<group>/… intrinsics on the global JSX namespace, which React 19's types
// removed in favour of React.JSX. Delete this file when apps/user moves to
// @react-three/fiber 9 (requires the React 19 runtime) — track 029, S4.
import type { ThreeElements } from '@react-three/fiber'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
