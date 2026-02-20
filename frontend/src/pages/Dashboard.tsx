import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'
import '../App.css'

type ActiveTool = ReturnType<ExcalidrawImperativeAPI['getAppState']>['activeTool']
type SceneUpdatePayload = Parameters<ExcalidrawImperativeAPI['updateScene']>[0]
type CatalogLoadState = 'idle' | 'loading' | 'ready' | 'error'
type ExcalidrawApiWithLibraryImport = ExcalidrawImperativeAPI & {
  updateLibrary?: (params: {
    libraryItems: unknown[]
    merge: boolean
    prompt: boolean
    openLibraryMenu: boolean
  }) => void | Promise<void>
}
type CatalogCollection = {
  id: string
  name: string
  source: string
  description?: string
  author?: string
  preview?: string
}

const LIBRARY_CATALOG_URL =
  'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries.json'
const LIBRARY_SOURCE_BASE_URL =
  'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/'

const FALLBACK_CATALOG: CatalogCollection[] = [
  {
    id: 'fallback-charts',
    name: 'Charts',
    source: 'charts/charts.json',
    description: 'Coleccion de graficos y elementos para tableros.',
    author: 'lamwai82',
  },
  {
    id: 'fallback-brands',
    name: 'Brand Logos',
    source: 'brands/brands logos (library).json',
    description: 'Iconos y logotipos para diagramas de producto.',
    author: 'chakrihacker',
  },
  {
    id: 'fallback-humanities',
    name: 'Humanities and Social Sciences Icons',
    source: 'education/literature/humanities-and-social-sciences-icons.json',
    description: 'Iconos educativos para mapas conceptuales.',
    author: 'jerrylow',
  },
  {
    id: 'fallback-material',
    name: 'Material Icons (Filled)',
    source: 'libraries/icons/material-design-icons-filled.excalidrawlib',
    description: 'Pack de iconos generales tipo material.',
    author: 'toolzflow',
  },
  {
    id: 'fallback-cosmos',
    name: 'Cosmology Icons',
    source: 'science/physics/cosmology icons.excalidrawlib',
    description: 'Coleccion cientifica para diagramas de fisica.',
    author: 'rdrahn',
  },
  {
    id: 'fallback-theory',
    name: 'Theory of Constraints',
    source: 'business/strategy and planning/theory_of_constraints_3_entities.json',
    description: 'Plantillas para teoria de restricciones.',
    author: 'mihaialbert',
  },
]

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

  if (Array.isArray(parsed.library)) {
    return parsed.library
  }

  if (isRecord(parsed.library)) {
    if (Array.isArray(parsed.library.libraryItems)) {
      return parsed.library.libraryItems
    }

    if (Array.isArray(parsed.library.library)) {
      return parsed.library.library
    }
  }

  return null
}

const extractCatalogPreview = (entry: Record<string, unknown>): string | undefined => {
  const preview = entry.preview

  if (typeof preview === 'string' && preview.trim()) {
    return preview.trim()
  }

  if (!isRecord(preview)) {
    return undefined
  }

  const candidatePreviewFields = ['url', 'src', 'image', 'path'] as const
  for (const field of candidatePreviewFields) {
    const fieldValue = preview[field]
    if (typeof fieldValue === 'string' && fieldValue.trim()) {
      return fieldValue.trim()
    }
  }

  return undefined
}

const parseCatalogCollections = (rawCatalog: unknown): CatalogCollection[] => {
  if (!Array.isArray(rawCatalog)) {
    return []
  }

  return rawCatalog.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return []
    }

    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const source = typeof entry.source === 'string' ? entry.source.trim() : ''

    if (!name || !source) {
      return []
    }

    const preview = extractCatalogPreview(entry)

    const description =
      typeof entry.description === 'string' && entry.description.trim()
        ? entry.description.trim()
        : undefined

    let author: string | undefined
    if (isRecord(entry.author) && typeof entry.author.name === 'string' && entry.author.name.trim()) {
      author = entry.author.name.trim()
    }

    return [
      {
        id: `${source}-${index}`,
        name,
        source,
        preview: preview ? resolveCatalogAssetUrl(preview) : undefined,
        description,
        author,
      },
    ]
  })
}

const resolveCatalogAssetUrl = (source: string): string => {
  try {
    const directUrl = new URL(source)
    if (
      directUrl.protocol === 'http:' ||
      directUrl.protocol === 'https:' ||
      directUrl.protocol === 'data:'
    ) {
      return directUrl.toString()
    }
  } catch {
    // Fall through to repository relative path.
  }

  return new URL(source.replace(/^\/+/, ''), LIBRARY_SOURCE_BASE_URL).toString()
}

type CatalogPreviewProps = {
  collectionName: string
  previewUrl?: string
}

const CatalogPreview = ({ collectionName, previewUrl }: CatalogPreviewProps) => {
  const [hasPreviewError, setHasPreviewError] = useState(false)

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewUrl])

  const showPreviewImage = Boolean(previewUrl) && !hasPreviewError
  const fallbackLabel = collectionName.trim().charAt(0).toUpperCase() || '?'

  return (
    <div
      aria-hidden="true"
      className={`library-catalog-card-preview${showPreviewImage ? '' : ' is-fallback'}`}
    >
      {showPreviewImage ? (
        <img
          alt=""
          className="library-catalog-card-preview-image"
          loading="lazy"
          onError={() => {
            setHasPreviewError(true)
          }}
          src={previewUrl}
        />
      ) : (
        <span className="library-catalog-card-preview-fallback">{fallbackLabel}</span>
      )}
    </div>
  )
}

export default function Dashboard() {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const libraryFileInputRef = useRef<HTMLInputElement | null>(null)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [penModeEnabled, setPenModeEnabled] = useState(false)
  const [isCatalogOpen, setIsCatalogOpen] = useState(false)
  const [catalogLoadState, setCatalogLoadState] = useState<CatalogLoadState>('idle')
  const [catalogCollections, setCatalogCollections] = useState<CatalogCollection[]>(FALLBACK_CATALOG)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [collectionBeingAddedId, setCollectionBeingAddedId] = useState<string | null>(null)
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

  const loadCatalogCollections = useCallback(async () => {
    if (catalogLoadState === 'loading') {
      return
    }

    setCatalogLoadState('loading')
    setCatalogError(null)

    try {
      const response = await fetch(LIBRARY_CATALOG_URL, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`No se pudo cargar el catalogo (HTTP ${response.status}).`)
      }

      const parsedCatalog = (await response.json()) as unknown
      const parsedCollections = parseCatalogCollections(parsedCatalog)

      if (parsedCollections.length === 0) {
        throw new Error('El catalogo recibido no tiene colecciones validas.')
      }

      setCatalogCollections(parsedCollections)
      setCatalogLoadState('ready')
    } catch (error) {
      setCatalogLoadState('error')
      setCatalogError(error instanceof Error ? error.message : 'No se pudo cargar el catalogo.')
      setCatalogCollections(FALLBACK_CATALOG)
    }
  }, [catalogLoadState])

  const handleOpenCatalog = () => {
    setIsCatalogOpen(true)
    if (catalogLoadState === 'idle') {
      void loadCatalogCollections()
    }
  }

  const handleCloseCatalog = () => {
    if (collectionBeingAddedId) {
      return
    }

    setIsCatalogOpen(false)
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

  const handleAddCollection = async (collection: CatalogCollection) => {
    if (collectionBeingAddedId) {
      return
    }

    setCollectionBeingAddedId(collection.id)

    try {
      const sourceUrl = resolveCatalogAssetUrl(collection.source)
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        throw new Error(`No se pudo descargar la coleccion (HTTP ${response.status}).`)
      }

      const collectionText = await response.text()
      const totalImported = await importLibraryFromText(collectionText)
      showToast(`Coleccion agregada: ${collection.name} (${totalImported} figuras).`)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'No se pudo agregar la coleccion seleccionada.',
        3200,
      )
    } finally {
      setCollectionBeingAddedId(null)
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
    const handleLibraryExternalLink = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      const externalLibraryLink = target.closest(
        '.layer-ui__library a[href*="libraries.excalidraw.com"]',
      )
      if (!externalLibraryLink) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      showToast('Usa el boton Catalogo para agregar colecciones.', 2600)
      setIsCatalogOpen(true)

      if (catalogLoadState === 'idle') {
        void loadCatalogCollections()
      }
    }

    window.addEventListener('click', handleLibraryExternalLink, true)
    return () => {
      window.removeEventListener('click', handleLibraryExternalLink, true)
    }
  }, [catalogLoadState, loadCatalogCollections])

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
          <p className="dashboard-user">Modo dibujo tactil</p>
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
            onClick={handleOpenCatalog}
            title="Abrir catalogo de colecciones"
            type="button"
          >
            <span aria-hidden="true" className="dashboard-action-icon">
              <svg fill="none" viewBox="0 0 24 24">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" strokeWidth="1.8" />
              </svg>
            </span>
            Catalogo
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

      {isCatalogOpen ? (
        <div
          aria-label="Catalogo de colecciones"
          aria-modal="true"
          className="library-catalog-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseCatalog()
            }
          }}
          role="dialog"
        >
          <section className="library-catalog-panel">
            <header className="library-catalog-header">
              <div className="library-catalog-heading">
                <h2 className="library-catalog-title">Catalogo de colecciones</h2>
                <p className="library-catalog-subtitle">Agrega figuras sin salir de la app.</p>
              </div>
              <button className="library-catalog-close" onClick={handleCloseCatalog} type="button">
                Cerrar
              </button>
            </header>

            <div className="library-catalog-actions">
              <button
                className="dashboard-action dashboard-action--import"
                onClick={handleImportFromFileClick}
                type="button"
              >
                Importar archivo local
              </button>
              <button
                className="dashboard-action"
                disabled={catalogLoadState === 'loading'}
                onClick={() => {
                  void loadCatalogCollections()
                }}
                type="button"
              >
                {catalogLoadState === 'loading' ? 'Actualizando...' : 'Actualizar catalogo'}
              </button>
            </div>

            {catalogLoadState === 'loading' ? (
              <p className="library-catalog-state">Cargando colecciones...</p>
            ) : null}
            {catalogError ? (
              <p className="library-catalog-state library-catalog-state--error">
                {catalogError} Se muestra una lista de respaldo local.
              </p>
            ) : null}

            {catalogCollections.length > 0 ? (
              <div className="library-catalog-grid">
                {catalogCollections.map((collection) => {
                  const isAddingThisCollection = collectionBeingAddedId === collection.id
                  const isAddingAnotherCollection =
                    !!collectionBeingAddedId && collectionBeingAddedId !== collection.id

                  return (
                    <article className="library-catalog-card" key={collection.id}>
                      <CatalogPreview
                        collectionName={collection.name}
                        previewUrl={collection.preview}
                      />
                      <h3 className="library-catalog-card-title">{collection.name}</h3>
                      <p className="library-catalog-card-meta">{collection.author ?? 'Comunidad'}</p>
                      <p className="library-catalog-card-description">
                        {collection.description ?? 'Coleccion de figuras lista para importar.'}
                      </p>
                      <button
                        className="dashboard-action library-catalog-add"
                        disabled={isAddingAnotherCollection || isAddingThisCollection}
                        onClick={() => {
                          void handleAddCollection(collection)
                        }}
                        type="button"
                      >
                        {isAddingThisCollection ? 'Agregando...' : 'Agregar'}
                      </button>
                    </article>
                  )
                })}
              </div>
            ) : (
              <p className="library-catalog-empty">No hay colecciones disponibles.</p>
            )}
          </section>
        </div>
      ) : null}

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
