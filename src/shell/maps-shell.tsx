/**
 * Root layout shell: full-bleed map + chrome overlay.
 *
 * Ported from flight-planner's `FlightShell` with the `.kfp-` → `.kmaps-`
 * scope rename. The Knosys host's flex tree uses `min-height` (not
 * `height`) on the SidebarProvider, so CSS `height: 100%` can't resolve
 * down the chain and `.kmaps-root` collapses to 0. We sidestep that by
 * measuring `window.innerHeight - rect.top` at mount and pinning our
 * root height inline. Re-measure on viewport resize.
 *
 * The shell renders the map in a z-index 0 layer and the chrome (pill,
 * layers button, rail, sheet) in a z-index 1 overlay with
 * `pointer-events: none`. Chrome children opt back in via
 * `pointer-events: auto` (handled by `.kmaps-chrome-layer > *` in the
 * stylesheet) so the map can still pan/zoom under the chrome gaps.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export interface MapsShellProps {
  /** Map viewer (MapLibre canvas) rendered into the z-0 layer. */
  map: ReactNode
  /** Chrome overlay (pill, layers, rail, sheet) rendered into z-1. */
  children?: ReactNode
}

export function MapsShell({ map, children }: MapsShellProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [fittedHeight, setFittedHeight] = useState<number | null>(null)

  useEffect(() => {
    const fit = () => {
      const el = rootRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      setFittedHeight(Math.max(200, window.innerHeight - top))
    }
    fit()
    // Re-measure after the host's flex layout settles. Browsers sometimes
    // report a different `getBoundingClientRect().top` on the second tick.
    const t = setTimeout(fit, 50)
    window.addEventListener('resize', fit)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', fit)
    }
  }, [])

  const style: CSSProperties = {
    height: fittedHeight != null ? `${fittedHeight}px` : '100%',
  }

  return (
    <div ref={rootRef} className="kmaps-root" style={style}>
      <div className="kmaps-map-layer">{map}</div>
      <div className="kmaps-chrome-layer">{children}</div>
    </div>
  )
}
