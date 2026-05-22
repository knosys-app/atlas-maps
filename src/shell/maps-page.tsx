/**
 * Maps page — scaffolded shell.
 *
 * This is the route component the host mounts at `/maps`. The full
 * flight-planner shell (Plan Pill / Layers / Rail / Sheet / Map) lands
 * incrementally in follow-on sessions. v3.0's MVP scope is the routing
 * preview flow; v3.1 adds live nav UI; v3.2 adds voice + spotlight.
 *
 * For now this component:
 *   - mounts under .kmaps-root so styles.css scope works
 *   - shows the starter region count + active region (when set)
 *   - exposes a no-arg "Install engine + first region" CTA for smoke tests
 */

import { useEffect, useState } from 'react'
import { STARTER_REGIONS, STARTER_REGION_COUNT } from '@/data/regions'
import { getPluginApi } from '@/index'
import { installEngineIfMissing } from '@/routing/engine'

export function MapsPage(): JSX.Element {
  const [engineReady, setEngineReady] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const api = getPluginApi()
        await installEngineIfMissing(api, (phase, _percent, message) => {
          if (!cancelled) setProgress(`${phase}${message ? `: ${message}` : ''}`)
        })
        if (!cancelled) setEngineReady(true)
      } catch (err) {
        if (!cancelled) {
          setEngineReady(false)
          setError((err as Error).message)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="kmaps-root" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Maps</h1>
        <p style={{ color: '#888', marginBottom: 24 }}>
          Offline driving navigation. Search, route, turn-by-turn, GPS — fully offline once you&rsquo;ve
          downloaded a region.
        </p>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Engine</h2>
          {engineReady === null && <p>Checking Valhalla install&hellip; {progress}</p>}
          {engineReady === true && <p style={{ color: '#34c759' }}>Engine ready.</p>}
          {engineReady === false && (
            <p style={{ color: '#ff453a' }}>
              Engine not available: {error ?? 'unknown error'}
            </p>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Available regions ({STARTER_REGION_COUNT})
          </h2>
          <ul style={{ columns: 3, columnGap: 24, listStyle: 'none', padding: 0 }}>
            {STARTER_REGIONS.slice(0, 30).map((r) => (
              <li key={r.id} style={{ padding: '4px 0', fontSize: 13 }}>
                {r.displayName}
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 12, color: '#888', fontSize: 12 }}>
            …plus {STARTER_REGION_COUNT - 30} more. The full UI (rail, sheet, map) lands in a
            follow-on session.
          </p>
        </section>
      </div>
    </div>
  )
}
