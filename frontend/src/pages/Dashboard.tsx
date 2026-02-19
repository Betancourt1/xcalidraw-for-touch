import { useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'
import '../App.css'

type ActiveTool = ReturnType<ExcalidrawImperativeAPI['getAppState']>['activeTool']

export default function Dashboard() {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
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

  useEffect(() => {
    if (!excalidrawApi) return

    excalidrawApi.setActiveTool({ type: 'freedraw' })
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

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      touchPointerIds.delete(event.pointerId)
      restoreToolAfterTouch()
    }

    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      unsubscribePointerDown()
      unsubscribePointerUp()
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
