import { useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'
import '../App.css'

type ActiveTool = ReturnType<ExcalidrawImperativeAPI['getAppState']>['activeTool']

export default function Dashboard() {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [penModeEnabled, setPenModeEnabled] = useState(false)
  const touchPointerIdsRef = useRef(new Set<number>())
  const toolBeforeTouchRef = useRef<ActiveTool | null>(null)

  const uiOptions = useMemo<UIOptions>(
    () => ({
      canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        toggleTheme: false,
      },
      tools: {
        image: false,
      },
    }),
    [],
  )

  const handleNewCanvas = () => {
    excalidrawApiRef.current?.resetScene()
    excalidrawApiRef.current?.history.clear()
  }

  const handleTogglePenMode = () => {
    const api = excalidrawApiRef.current
    if (!api) return

    const nextPenMode = !api.getAppState().penMode
    api.updateScene({ appState: { penMode: nextPenMode } })
    api.setToast({
      message: nextPenMode ? 'Solo stylus activo' : 'Touch y stylus activos',
      duration: 1800,
      closable: false,
    })
  }

  useEffect(() => {
    if (!excalidrawApi) return

    excalidrawApi.setActiveTool({ type: 'freedraw' })
    setPenModeEnabled(excalidrawApi.getAppState().penMode)
    const touchPointerIds = touchPointerIdsRef.current

    const restoreToolAfterTouch = () => {
      if (touchPointerIds.size > 0) return
      const toolBeforeTouch = toolBeforeTouchRef.current
      if (!toolBeforeTouch) return

      toolBeforeTouchRef.current = null
      const currentTool = excalidrawApi.getAppState().activeTool
      if (currentTool.type === 'hand') {
        excalidrawApi.setActiveTool(toolBeforeTouch)
      }
    }

    const unsubscribePointerDown = excalidrawApi.onPointerDown((activeTool, _pointerDownState, event) => {
      if (event.pointerType === 'pen') {
        touchPointerIds.clear()
        restoreToolAfterTouch()
        return
      }

      if (event.pointerType !== 'touch') return

      const isFirstTouch = touchPointerIds.size === 0
      touchPointerIds.add(event.pointerId)

      if (!isFirstTouch) return

      if (activeTool.type !== 'hand') {
        toolBeforeTouchRef.current = { ...activeTool }
        excalidrawApi.setActiveTool({ type: 'hand' })
      }
    })

    const unsubscribePointerUp = excalidrawApi.onPointerUp((_activeTool, _pointerDownState, event) => {
      if (event.pointerType !== 'touch') return

      touchPointerIds.delete(event.pointerId)
      restoreToolAfterTouch()
    })
    const unsubscribeChange = excalidrawApi.onChange((_elements, appState) => {
      setPenModeEnabled(appState.penMode)
    })

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      touchPointerIds.delete(event.pointerId)
      restoreToolAfterTouch()
    }

    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      unsubscribePointerDown()
      unsubscribePointerUp()
      unsubscribeChange()
      window.removeEventListener('pointercancel', handlePointerCancel)
      touchPointerIds.clear()
      toolBeforeTouchRef.current = null
    }
  }, [excalidrawApi])

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-brand">
          <h1 className="dashboard-title">Excalidraw</h1>
          <p className="dashboard-user">Modo dibujo táctil</p>
        </div>

        <div className="dashboard-actions">
          <button
            aria-pressed={penModeEnabled}
            className={`dashboard-action dashboard-action--pen-mode${penModeEnabled ? ' is-active' : ''}`}
            onClick={handleTogglePenMode}
            title={penModeEnabled ? 'Solo stylus para dibujar' : 'Touch y stylus para dibujar'}
            type="button"
          >
            <span aria-hidden="true" className="dashboard-action-icon">
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="M4 20l3-1l9-9a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L3 15l-1 3z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path d="M12 6l4 4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                {penModeEnabled ? (
                  <path d="M5 5l14 14" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                ) : (
                  <circle cx="18.2" cy="18.2" r="2.3" fill="currentColor" />
                )}
              </svg>
            </span>
            {penModeEnabled ? 'Solo stylus' : 'Touch + stylus'}
          </button>
          <button className="dashboard-action" onClick={handleNewCanvas} type="button">
            Lienzo nuevo
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-canvas">
          <div className="dashboard-canvas-host">
            <Excalidraw
              autoFocus
              langCode="es-ES"
              detectScroll={false}
              handleKeyboardGlobally={false}
              UIOptions={uiOptions}
              excalidrawAPI={(api) => {
                excalidrawApiRef.current = api
                setExcalidrawApi(api)
              }}
            />
          </div>
        </section>
      </main>
    </div>
  )
}
