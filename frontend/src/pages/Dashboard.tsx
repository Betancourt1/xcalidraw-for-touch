import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'
import '../App.css'

type ActiveTool = ReturnType<ExcalidrawImperativeAPI['getAppState']>['activeTool']
type SceneUpdatePayload = Parameters<ExcalidrawImperativeAPI['updateScene']>[0]
type ExcalidrawApiWithLibraryImport = ExcalidrawImperativeAPI & {
  updateLibrary?: (params: {
    libraryItems: unknown[]
    merge: boolean
    prompt: boolean
    openLibraryMenu: boolean
  }) => void | Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const extractLibraryItems = (parsed: unknown): unknown[] | null => {
  if (Array.isArray(parsed)) {
    return parsed
  }

  if (!isRecord(parsed)) {
    return null
  }

  if (Array.isArray(parsed.libraryItems)) {
    return parsed.libraryItems
  }

  return null
}

const normalizeUrl = (rawValue: string): string | null => {
  try {
    const parsedUrl = new URL(rawValue)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null
    }

    return parsedUrl.toString()
  } catch {
    return null
  }
}

const extractLibraryUrlFromHash = (hashValue: string): string | null => {
  const hashParams = new URLSearchParams(hashValue.startsWith('#') ? hashValue.slice(1) : hashValue)
  const addLibraryValue = hashParams.get('addLibrary')

  if (!addLibraryValue) {
    return null
  }

  const normalizedUrl = normalizeUrl(addLibraryValue)
  if (normalizedUrl) {
    return normalizedUrl
  }

  try {
    return normalizeUrl(decodeURIComponent(addLibraryValue))
  } catch {
    return null
  }
}

const resolveLibraryUrl = (userInput: string): string | null => {
  const trimmedInput = userInput.trim()
  if (!trimmedInput) {
    return null
  }

  if (trimmedInput.startsWith('#')) {
    return extractLibraryUrlFromHash(trimmedInput)
  }

  const normalizedDirectUrl = normalizeUrl(trimmedInput)
  if (!normalizedDirectUrl) {
    return null
  }

  const parsedDirectUrl = new URL(normalizedDirectUrl)
  const hashLibraryUrl = extractLibraryUrlFromHash(parsedDirectUrl.hash)
  if (hashLibraryUrl) {
    return hashLibraryUrl
  }

  return parsedDirectUrl.toString()
}

export default function Dashboard() {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const libraryFileInputRef = useRef<HTMLInputElement | null>(null)
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

  const showToast = (message: string, duration = 2200) => {
    const api = excalidrawApiRef.current
    if (!api || typeof api.setToast !== 'function') return

    api.setToast({
      message,
      duration,
      closable: false,
    })
  }

  const importLibraryItems = async (libraryItems: unknown[]) => {
    const api = excalidrawApiRef.current
    if (!api) {
      throw new Error('El editor aun no esta listo.')
    }

    const apiWithLibraryImport = api as ExcalidrawApiWithLibraryImport
    if (typeof apiWithLibraryImport.updateLibrary === 'function') {
      await apiWithLibraryImport.updateLibrary({
        libraryItems,
        merge: true,
        prompt: false,
        openLibraryMenu: true,
      })
      return
    }

    api.updateScene({ libraryItems } as SceneUpdatePayload)
  }

  const importLibraryFromText = async (rawText: string): Promise<number> => {
    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(rawText) as unknown
    } catch {
      throw new Error('El contenido no es JSON valido.')
    }

    const libraryItems = extractLibraryItems(parsedJson)
    if (!libraryItems || libraryItems.length === 0) {
      throw new Error('No se encontraron figuras para importar.')
    }

    await importLibraryItems(libraryItems)
    return libraryItems.length
  }

  const handleImportFromFileClick = () => {
    libraryFileInputRef.current?.click()
  }

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''

    if (!selectedFile) return

    const fileReader = new FileReader()

    fileReader.onload = () => {
      const rawText = fileReader.result
      if (typeof rawText !== 'string') {
        showToast('No se pudo leer el archivo.', 3200)
        return
      }

      void (async () => {
        try {
          const totalImported = await importLibraryFromText(rawText)
          showToast(`Biblioteca importada (${totalImported} elementos).`)
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : 'No se pudo importar la biblioteca desde archivo.',
            3200,
          )
        }
      })()
    }

    fileReader.onerror = () => {
      showToast('No se pudo leer el archivo.', 3200)
    }

    fileReader.readAsText(selectedFile)
  }

  const handleImportFromUrl = async () => {
    const userInput = window.prompt('Pega la URL de la biblioteca:')
    if (!userInput) return

    const libraryUrl = resolveLibraryUrl(userInput)
    if (!libraryUrl) {
      showToast('URL invalida. Usa http(s) o #addLibrary=...', 3200)
      return
    }

    try {
      const response = await fetch(libraryUrl)
      if (!response.ok) {
        throw new Error(`No se pudo descargar la biblioteca (HTTP ${response.status}).`)
      }

      const responseText = await response.text()
      const totalImported = await importLibraryFromText(responseText)
      showToast(`Biblioteca importada desde URL (${totalImported} elementos).`)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'No se pudo importar la biblioteca desde URL.',
        3200,
      )
    }
  }

  const handleTogglePenMode = () => {
    const api = excalidrawApiRef.current
    if (!api) return

    const nextPenMode = !api.getAppState().penMode
    api.updateScene({ appState: { penMode: nextPenMode } })
    showToast(nextPenMode ? 'Solo stylus activo' : 'Touch y stylus activos', 1800)
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
          <button
            className="dashboard-action dashboard-action--import"
            onClick={handleImportFromFileClick}
            title="Importar biblioteca desde archivo"
            type="button"
          >
            <span aria-hidden="true" className="dashboard-action-icon">
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="M12 4v10m0 0l4-4m-4 4l-4-4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path
                  d="M5 18h14"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </span>
            Importar archivo
          </button>
          <button
            className="dashboard-action dashboard-action--import"
            onClick={() => {
              void handleImportFromUrl()
            }}
            title="Importar biblioteca desde URL"
            type="button"
          >
            <span aria-hidden="true" className="dashboard-action-icon">
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="M10.5 13.5L13.5 10.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path
                  d="M8.2 15.8a3 3 0 0 1 0-4.3l2.1-2.1a3 3 0 0 1 4.3 0"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path
                  d="M15.8 8.2a3 3 0 0 1 0 4.3l-2.1 2.1a3 3 0 0 1-4.3 0"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </span>
            Importar URL
          </button>
        </div>
        <input
          accept=".excalidrawlib,.json,application/json"
          className="dashboard-file-input"
          onChange={handleFileSelected}
          ref={libraryFileInputRef}
          type="file"
        />
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
