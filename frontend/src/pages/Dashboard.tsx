import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, UIAppState, UIOptions } from '@excalidraw/excalidraw/types'
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
type CatalogLibraryItem = {
  id: string
  name: string
  elements: Record<string, unknown>[]
  raw: Record<string, unknown>
}
type CatalogSelectionState = {
  collection: CatalogCollection
  items: CatalogLibraryItem[]
  selectedItemIds: string[]
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

const LIBRARY_ARRAY_CANDIDATE_KEYS = [
  'libraryItems',
  'items',
  'library',
  'libraries',
  'payload',
  'content',
  'data',
] as const
type RawLibraryEntry = Record<string, unknown> | unknown[]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const toFiniteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clamp = (value: number, minValue: number, maxValue: number): number =>
  Math.min(maxValue, Math.max(minValue, value))

const sanitizeColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

const extractRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is Record<string, unknown> => isRecord(entry))
}

const extractLibraryEntryArray = (value: unknown): RawLibraryEntry[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is RawLibraryEntry => isRecord(entry) || Array.isArray(entry))
}

const extractItemElements = (libraryItem: Record<string, unknown>): Record<string, unknown>[] => {
  const directElements = extractRecordArray(libraryItem.elements)
  if (directElements.length > 0) {
    return directElements
  }

  if (!isRecord(libraryItem.data)) {
    return []
  }

  return extractRecordArray(libraryItem.data.elements)
}

const stripUtf8Bom = (value: string): string => value.replace(/^\uFEFF/, '').trim()

const extractCandidateLibraryArrays = (parsed: unknown): RawLibraryEntry[][] => {
  const candidateArrays: RawLibraryEntry[][] = []
  const queue: Array<{ node: unknown; depth: number }> = [{ node: parsed, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    const { node, depth } = current
    if (depth > 5) {
      continue
    }

    if (Array.isArray(node)) {
      const libraryEntries = extractLibraryEntryArray(node)
      if (libraryEntries.length > 0) {
        candidateArrays.push(libraryEntries)
      }

      libraryEntries.forEach((entry) => {
        if (isRecord(entry) || Array.isArray(entry)) {
          queue.push({ node: entry, depth: depth + 1 })
        }
      })
      continue
    }

    if (!isRecord(node)) {
      continue
    }

    LIBRARY_ARRAY_CANDIDATE_KEYS.forEach((key) => {
      const value = node[key]
      if (!Array.isArray(value)) {
        return
      }

      const libraryEntries = extractLibraryEntryArray(value)
      if (libraryEntries.length > 0) {
        candidateArrays.push(libraryEntries)
      }
    })

    Object.values(node).forEach((value) => {
      if (isRecord(value) || Array.isArray(value)) {
        queue.push({ node: value, depth: depth + 1 })
      }
    })
  }

  return candidateArrays
}

const normalizeLibraryItems = (libraryItems: RawLibraryEntry[]): Record<string, unknown>[] =>
  libraryItems.flatMap((entry, index) => {
    const entryRecord = isRecord(entry) ? entry : null
    const elements = entryRecord ? extractItemElements(entryRecord) : extractRecordArray(entry)
    if (elements.length === 0) {
      return []
    }

    const rawId =
      entryRecord && typeof entryRecord.id === 'string' && entryRecord.id.trim()
        ? entryRecord.id.trim()
        : `item-${index + 1}`
    const rawName =
      entryRecord && typeof entryRecord.name === 'string' && entryRecord.name.trim()
        ? entryRecord.name.trim()
        : `Figura ${index + 1}`
    const rawStatus =
      entryRecord && typeof entryRecord.status === 'string' && entryRecord.status.trim()
        ? entryRecord.status.trim()
        : 'published'
    const createdAt =
      entryRecord && typeof entryRecord.created === 'number' && Number.isFinite(entryRecord.created)
        ? entryRecord.created
        : Date.now() + index

    return [
      {
        ...(entryRecord ?? {}),
        id: rawId,
        name: rawName,
        status: rawStatus,
        created: createdAt,
        elements,
      },
    ]
  })

const extractLibraryItems = (parsed: unknown): Record<string, unknown>[] => {
  const candidateArrays = extractCandidateLibraryArrays(parsed)
  if (candidateArrays.length === 0) {
    return []
  }

  const normalizedCandidates = candidateArrays
    .map((candidateArray) => normalizeLibraryItems(candidateArray))
    .filter((candidateArray) => candidateArray.length > 0)
    .sort((left, right) => right.length - left.length)

  return normalizedCandidates[0] ?? []
}

const parseLibraryItemsFromText = (rawText: string): Record<string, unknown>[] => {
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(stripUtf8Bom(rawText)) as unknown
  } catch {
    throw new Error('El contenido no es JSON valido.')
  }

  const libraryItems = extractLibraryItems(parsedJson)
  if (libraryItems.length === 0) {
    throw new Error('No se encontraron figuras para importar.')
  }

  return libraryItems
}

const toCatalogLibraryItems = (libraryItems: Record<string, unknown>[]): CatalogLibraryItem[] =>
  libraryItems.map((entry, index) => {
    const rawId = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `item-${index + 1}`
    const rawName =
      typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `Figura ${index + 1}`

    return {
      id: `${rawId}-${index}`,
      name: rawName,
      elements: extractItemElements(entry),
      raw: entry,
    }
  })

const extractAbsolutePoints = (element: Record<string, unknown>): Array<{ x: number; y: number }> => {
  if (!Array.isArray(element.points)) {
    return []
  }

  const baseX = toFiniteNumber(element.x)
  const baseY = toFiniteNumber(element.y)

  return element.points.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      return []
    }

    const x = toFiniteNumber(point[0], Number.NaN)
    const y = toFiniteNumber(point[1], Number.NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return []
    }

    return [{ x: baseX + x, y: baseY + y }]
  })
}

const computeItemPreviewBounds = (
  elements: Record<string, unknown>[],
): { minX: number; minY: number; width: number; height: number } => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const expandBounds = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  elements.forEach((element) => {
    const x = toFiniteNumber(element.x)
    const y = toFiniteNumber(element.y)
    const width = toFiniteNumber(element.width)
    const height = toFiniteNumber(element.height)

    expandBounds(x, y)
    expandBounds(x + width, y + height)

    const points = extractAbsolutePoints(element)
    points.forEach((point) => {
      expandBounds(point.x, point.y)
    })
  })

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, width: 120, height: 84 }
  }

  const padding = 12
  const normalizedWidth = Math.max(maxX - minX, 40)
  const normalizedHeight = Math.max(maxY - minY, 30)

  return {
    minX: minX - padding,
    minY: minY - padding,
    width: normalizedWidth + padding * 2,
    height: normalizedHeight + padding * 2,
  }
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

const extractCatalogEntries = (rawCatalog: unknown): Record<string, unknown>[] => {
  if (Array.isArray(rawCatalog)) {
    return extractRecordArray(rawCatalog)
  }

  if (!isRecord(rawCatalog)) {
    return []
  }

  const candidateArrayKeys = ['libraries', 'items', 'collections', 'catalog'] as const
  for (const key of candidateArrayKeys) {
    const value = rawCatalog[key]
    if (!Array.isArray(value)) {
      continue
    }

    const entries = extractRecordArray(value)
    if (entries.length > 0) {
      return entries
    }
  }

  return []
}

const extractCatalogAuthor = (entry: Record<string, unknown>): string | undefined => {
  if (typeof entry.author === 'string' && entry.author.trim()) {
    return entry.author.trim()
  }

  if (isRecord(entry.author) && typeof entry.author.name === 'string' && entry.author.name.trim()) {
    return entry.author.name.trim()
  }

  if (!Array.isArray(entry.authors)) {
    return undefined
  }

  const authorNames = entry.authors.flatMap((authorEntry) => {
    if (typeof authorEntry === 'string' && authorEntry.trim()) {
      return [authorEntry.trim()]
    }

    if (isRecord(authorEntry) && typeof authorEntry.name === 'string' && authorEntry.name.trim()) {
      return [authorEntry.name.trim()]
    }

    return []
  })

  if (authorNames.length === 0) {
    return undefined
  }

  return authorNames.join(', ')
}

const parseCatalogCollections = (rawCatalog: unknown): CatalogCollection[] => {
  const catalogEntries = extractCatalogEntries(rawCatalog)
  if (catalogEntries.length === 0) {
    return []
  }

  return catalogEntries.flatMap((entry, index) => {
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

    const author = extractCatalogAuthor(entry)

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
  previewElements?: Record<string, unknown>[]
  onPreviewUnavailable?: () => void
}

type PreviewElementsSvgProps = {
  className: string
  elements: Record<string, unknown>[]
}

const PreviewElementsSvg = ({ className, elements }: PreviewElementsSvgProps) => {
  const bounds = useMemo(() => computeItemPreviewBounds(elements), [elements])

  return (
    <svg
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
    >
      {elements.map((element, index) => {
        const type = typeof element.type === 'string' ? element.type : 'rectangle'
        const rawX = toFiniteNumber(element.x)
        const rawY = toFiniteNumber(element.y)
        const rawWidth = toFiniteNumber(element.width)
        const rawHeight = toFiniteNumber(element.height)
        const x = Math.min(rawX, rawX + rawWidth)
        const y = Math.min(rawY, rawY + rawHeight)
        const width = Math.max(Math.abs(rawWidth), 1)
        const height = Math.max(Math.abs(rawHeight), 1)
        const stroke = sanitizeColor(element.strokeColor, '#2d4c70')
        const backgroundColor = sanitizeColor(element.backgroundColor, 'transparent')
        const fill = backgroundColor === 'transparent' ? 'none' : backgroundColor
        const strokeWidth = clamp(toFiniteNumber(element.strokeWidth, 2), 0.8, 6)
        const opacity = clamp(toFiniteNumber(element.opacity, 100), 0, 100) / 100
        const key = `${type}-${index}`

        if (type === 'ellipse') {
          return (
            <ellipse
              cx={x + width / 2}
              cy={y + height / 2}
              fill={fill}
              key={key}
              opacity={opacity}
              rx={width / 2}
              ry={height / 2}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          )
        }

        if (type === 'diamond') {
          const points = `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${
            y + height
          } ${x},${y + height / 2}`
          return (
            <polygon
              fill={fill}
              key={key}
              opacity={opacity}
              points={points}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          )
        }

        if (type === 'line' || type === 'arrow' || type === 'freedraw' || type === 'draw') {
          const points = extractAbsolutePoints(element)
          const polylinePoints =
            points.length > 0
              ? points.map((point) => `${point.x},${point.y}`).join(' ')
              : `${rawX},${rawY} ${rawX + rawWidth},${rawY + rawHeight}`

          return (
            <polyline
              fill="none"
              key={key}
              opacity={opacity}
              points={polylinePoints}
              stroke={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strokeWidth}
            />
          )
        }

        if (type === 'text') {
          const textValue = typeof element.text === 'string' && element.text.trim() ? element.text : 'TXT'
          const fontSize = clamp(toFiniteNumber(element.fontSize, 18), 10, 36)
          return (
            <text fill={stroke} fontSize={fontSize} key={key} opacity={opacity} x={x} y={y + fontSize}>
              {textValue.slice(0, 16)}
            </text>
          )
        }

        return (
          <rect
            fill={fill}
            height={height}
            key={key}
            opacity={opacity}
            rx={6}
            ry={6}
            stroke={stroke}
            strokeWidth={strokeWidth}
            width={width}
            x={x}
            y={y}
          />
        )
      })}
    </svg>
  )
}

const CatalogPreview = ({
  collectionName,
  previewUrl,
  previewElements,
  onPreviewUnavailable,
}: CatalogPreviewProps) => {
  const [hasPreviewError, setHasPreviewError] = useState(false)

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewUrl])

  const hasElementsPreview = Boolean(previewElements && previewElements.length > 0)
  const showPreviewImage = Boolean(previewUrl) && !hasPreviewError
  const fallbackLabel = collectionName.trim().charAt(0).toUpperCase() || '?'

  useEffect(() => {
    if (!showPreviewImage && !hasElementsPreview) {
      onPreviewUnavailable?.()
    }
  }, [hasElementsPreview, onPreviewUnavailable, showPreviewImage])

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
      ) : hasElementsPreview && previewElements ? (
        <PreviewElementsSvg className="library-catalog-card-preview-svg" elements={previewElements} />
      ) : (
        <span className="library-catalog-card-preview-fallback">{fallbackLabel}</span>
      )}
    </div>
  )
}

type LibraryItemPreviewProps = {
  itemName: string
  elements: Record<string, unknown>[]
}

const LibraryItemPreview = ({ itemName, elements }: LibraryItemPreviewProps) => {
  const hasRenderableElements = elements.length > 0
  const fallbackLabel = itemName.trim().charAt(0).toUpperCase() || '?'

  return (
    <div className={`library-item-preview${hasRenderableElements ? '' : ' is-fallback'}`}>
      {hasRenderableElements ? (
        <PreviewElementsSvg className="library-item-preview-svg" elements={elements} />
      ) : (
        <span className="library-item-preview-fallback">{fallbackLabel}</span>
      )}
    </div>
  )
}

export default function Dashboard() {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const libraryFileInputRef = useRef<HTMLInputElement | null>(null)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [isCatalogOpen, setIsCatalogOpen] = useState(false)
  const [catalogLoadState, setCatalogLoadState] = useState<CatalogLoadState>('idle')
  const [catalogCollections, setCatalogCollections] = useState<CatalogCollection[]>(FALLBACK_CATALOG)
  const [catalogPreviewElementsByCollectionId, setCatalogPreviewElementsByCollectionId] = useState<
    Record<string, Record<string, unknown>[]>
  >({})
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [collectionBeingAddedId, setCollectionBeingAddedId] = useState<string | null>(null)
  const [catalogSelection, setCatalogSelection] = useState<CatalogSelectionState | null>(null)
  const catalogPreviewLoadingRef = useRef(new Set<string>())
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
    const libraryItems = parseLibraryItemsFromText(rawText)

    await importLibraryItems(libraryItems)
    return libraryItems.length
  }

  const ensureCatalogCollectionPreview = useCallback(
    async (collection: CatalogCollection) => {
      if (catalogPreviewElementsByCollectionId[collection.id]?.length) {
        return
      }

      const inFlightRequests = catalogPreviewLoadingRef.current
      if (inFlightRequests.has(collection.id)) {
        return
      }

      inFlightRequests.add(collection.id)

      try {
        const sourceUrl = resolveCatalogAssetUrl(collection.source)
        const response = await fetch(sourceUrl)
        if (!response.ok) {
          return
        }

        const collectionText = await response.text()
        const parsedLibraryItems = parseLibraryItemsFromText(collectionText)
        const parsedCatalogItems = toCatalogLibraryItems(parsedLibraryItems)
        const previewItem = parsedCatalogItems.find((item) => item.elements.length > 0)

        if (!previewItem) {
          return
        }

        setCatalogPreviewElementsByCollectionId((currentMap) => {
          if (currentMap[collection.id]?.length) {
            return currentMap
          }

          return {
            ...currentMap,
            [collection.id]: previewItem.elements,
          }
        })
      } catch {
        // Ignore preview hydration errors; the card fallback remains usable.
      } finally {
        inFlightRequests.delete(collection.id)
      }
    },
    [catalogPreviewElementsByCollectionId],
  )

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

    setCatalogSelection(null)
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

  const handlePreviewCollection = async (collection: CatalogCollection) => {
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
      const parsedLibraryItems = parseLibraryItemsFromText(collectionText)
      const parsedCatalogItems = toCatalogLibraryItems(parsedLibraryItems)

      if (parsedCatalogItems.length === 0) {
        throw new Error('La coleccion no contiene figuras compatibles para previsualizar.')
      }

      const firstPreviewItem = parsedCatalogItems.find((item) => item.elements.length > 0)
      if (firstPreviewItem) {
        setCatalogPreviewElementsByCollectionId((currentMap) => {
          if (currentMap[collection.id]?.length) {
            return currentMap
          }

          return {
            ...currentMap,
            [collection.id]: firstPreviewItem.elements,
          }
        })
      }

      setCatalogSelection({
        collection,
        items: parsedCatalogItems,
        selectedItemIds: [],
      })
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'No se pudo cargar la previsualizacion de la coleccion.',
        3200,
      )
    } finally {
      setCollectionBeingAddedId(null)
    }
  }

  const handleCloseCatalogSelection = () => {
    if (collectionBeingAddedId) {
      return
    }

    setCatalogSelection(null)
  }

  const handleToggleCatalogItemSelection = (itemId: string) => {
    setCatalogSelection((current) => {
      if (!current) {
        return current
      }

      const alreadySelected = current.selectedItemIds.includes(itemId)
      return {
        ...current,
        selectedItemIds: alreadySelected
          ? current.selectedItemIds.filter((selectedId) => selectedId !== itemId)
          : [...current.selectedItemIds, itemId],
      }
    })
  }

  const handleSelectAllCatalogItems = () => {
    setCatalogSelection((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        selectedItemIds: current.items.map((item) => item.id),
      }
    })
  }

  const handleClearCatalogSelection = () => {
    setCatalogSelection((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        selectedItemIds: [],
      }
    })
  }

  const handleImportCatalogSelection = async (mode: 'selected' | 'all') => {
    if (!catalogSelection || collectionBeingAddedId) {
      return
    }

    const selectedIdSet = new Set(catalogSelection.selectedItemIds)
    const itemsToImport =
      mode === 'all'
        ? catalogSelection.items
        : catalogSelection.items.filter((item) => selectedIdSet.has(item.id))

    if (itemsToImport.length === 0) {
      showToast('Selecciona al menos una figura para importar.', 2600)
      return
    }

    setCollectionBeingAddedId(catalogSelection.collection.id)

    try {
      await importLibraryItems(itemsToImport.map((item) => item.raw))
      showToast(
        `Coleccion agregada: ${catalogSelection.collection.name} (${itemsToImport.length} figuras).`,
      )
      setCatalogSelection(null)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'No se pudieron agregar las figuras seleccionadas.',
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

  const selectedCatalogItemsCount = catalogSelection?.selectedItemIds.length ?? 0
  const totalCatalogItemsCount = catalogSelection?.items.length ?? 0
  const isCatalogSelectionImporting =
    !!catalogSelection && collectionBeingAddedId === catalogSelection.collection.id

  const renderTopRightUI = (_isMobile: boolean, appState: UIAppState) => {
    const isPenMode = appState.penMode

    return (
      <div aria-label="Acciones rapidas" className="excal-toolbar-actions" role="toolbar">
        <button
          aria-label={isPenMode ? 'Activar touch y stylus' : 'Activar solo stylus'}
          aria-pressed={isPenMode}
          className={`dashboard-action excal-toolbar-button dashboard-action--pen-mode${
            isPenMode ? ' is-active' : ''
          }`}
          onClick={handleTogglePenMode}
          title={isPenMode ? 'Solo stylus para dibujar' : 'Touch y stylus para dibujar'}
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
              {isPenMode ? (
                <path d="M5 5l14 14" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              ) : (
                <circle cx="18.2" cy="18.2" r="2.3" fill="currentColor" />
              )}
            </svg>
          </span>
          <span className="dashboard-action-label">{isPenMode ? 'Solo stylus' : 'Touch + stylus'}</span>
        </button>
        <button
          aria-label="Crear lienzo nuevo"
          className="dashboard-action excal-toolbar-button"
          onClick={handleNewCanvas}
          title="Crear lienzo nuevo"
          type="button"
        >
          <span aria-hidden="true" className="dashboard-action-icon">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeWidth="1.9" />
            </svg>
          </span>
          <span className="dashboard-action-label">Lienzo nuevo</span>
        </button>
        <button
          aria-label="Abrir catalogo de colecciones"
          className="dashboard-action dashboard-action--import excal-toolbar-button"
          onClick={handleOpenCatalog}
          title="Abrir catalogo de colecciones"
          type="button"
        >
          <span aria-hidden="true" className="dashboard-action-icon">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" strokeWidth="1.8" />
            </svg>
          </span>
          <span className="dashboard-action-label">Catalogo</span>
        </button>
      </div>
    )
  }

  return (
    <div className="dashboard-shell">
      <input
        accept=".excalidrawlib,.json,application/json"
        className="dashboard-file-input"
        onChange={handleFileSelected}
        ref={libraryFileInputRef}
        type="file"
      />

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
                <h2 className="library-catalog-title">
                  {catalogSelection ? catalogSelection.collection.name : 'Catalogo de colecciones'}
                </h2>
                <p className="library-catalog-subtitle">
                  {catalogSelection
                    ? 'Previsualiza y selecciona solo las figuras que quieras importar.'
                    : 'Agrega figuras sin salir de la app.'}
                </p>
              </div>
              <button className="library-catalog-close" onClick={handleCloseCatalog} type="button">
                Cerrar
              </button>
            </header>

            {catalogSelection ? (
              <>
                <div className="library-catalog-actions">
                  <button
                    className="dashboard-action"
                    disabled={isCatalogSelectionImporting}
                    onClick={handleCloseCatalogSelection}
                    type="button"
                  >
                    Volver al catalogo
                  </button>
                  <button
                    className="dashboard-action"
                    disabled={isCatalogSelectionImporting || selectedCatalogItemsCount >= totalCatalogItemsCount}
                    onClick={handleSelectAllCatalogItems}
                    type="button"
                  >
                    Seleccionar todo
                  </button>
                  <button
                    className="dashboard-action"
                    disabled={isCatalogSelectionImporting || selectedCatalogItemsCount === 0}
                    onClick={handleClearCatalogSelection}
                    type="button"
                  >
                    Limpiar seleccion
                  </button>
                  <button
                    className="dashboard-action dashboard-action--import"
                    disabled={isCatalogSelectionImporting || selectedCatalogItemsCount === 0}
                    onClick={() => {
                      void handleImportCatalogSelection('selected')
                    }}
                    type="button"
                  >
                    {isCatalogSelectionImporting
                      ? 'Agregando...'
                      : `Agregar seleccionadas (${selectedCatalogItemsCount})`}
                  </button>
                </div>

                <p className="library-catalog-state">
                  Seleccionadas {selectedCatalogItemsCount} de {totalCatalogItemsCount} figuras.
                </p>

                {catalogSelection.items.length > 0 ? (
                  <div className="library-item-grid">
                    {catalogSelection.items.map((item) => {
                      const isSelected = catalogSelection.selectedItemIds.includes(item.id)
                      return (
                        <button
                          aria-label={`${
                            isSelected ? 'Quitar' : 'Seleccionar'
                          } ${item.name} para importar`}
                          aria-pressed={isSelected}
                          className={`library-item-card${isSelected ? ' is-selected' : ''}`}
                          disabled={isCatalogSelectionImporting}
                          key={item.id}
                          onClick={() => {
                            handleToggleCatalogItemSelection(item.id)
                          }}
                          type="button"
                        >
                          <span className="library-item-card-check" aria-hidden="true">
                            {isSelected ? 'x' : '+'}
                          </span>
                          <LibraryItemPreview elements={item.elements} itemName={item.name} />
                          <span className="library-item-card-title">{item.name}</span>
                          <span className="library-item-card-meta">
                            {item.elements.length > 0
                              ? `${item.elements.length} elementos`
                              : 'Previsualizacion no disponible'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="library-catalog-empty">No se encontraron figuras en esta coleccion.</p>
                )}
              </>
            ) : (
              <>
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
                      const isLoadingThisCollection = collectionBeingAddedId === collection.id
                      const isLoadingAnotherCollection =
                        !!collectionBeingAddedId && collectionBeingAddedId !== collection.id

                      return (
                        <article className="library-catalog-card" key={collection.id}>
                          <CatalogPreview
                            collectionName={collection.name}
                            onPreviewUnavailable={() => {
                              void ensureCatalogCollectionPreview(collection)
                            }}
                            previewElements={catalogPreviewElementsByCollectionId[collection.id]}
                            previewUrl={collection.preview}
                          />
                          <h3 className="library-catalog-card-title">{collection.name}</h3>
                          <p className="library-catalog-card-meta">{collection.author ?? 'Comunidad'}</p>
                          <p className="library-catalog-card-description">
                            {collection.description ?? 'Coleccion de figuras lista para importar.'}
                          </p>
                          <button
                            className="dashboard-action library-catalog-add"
                            disabled={isLoadingAnotherCollection || isLoadingThisCollection}
                            onClick={() => {
                              void handlePreviewCollection(collection)
                            }}
                            type="button"
                          >
                            {isLoadingThisCollection ? 'Cargando...' : 'Ver figuras'}
                          </button>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="library-catalog-empty">No hay colecciones disponibles.</p>
                )}
              </>
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
              renderTopRightUI={renderTopRightUI}
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
