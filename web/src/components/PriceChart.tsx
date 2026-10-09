import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type LogicalRange,
  type SeriesAttachedParameter,
  type SeriesDataItemTypeMap,
  type SeriesType,
  type Time,
} from 'lightweight-charts'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Candle, IndicatorSettings, Line, Range, RangePoints } from '../api'
import { candleTime, formatRange, onlyTailChanged, pricePrecision } from '../format'
import { bollinger, ema, macd, rsi, sma } from '../indicators'
import { maColor } from '../settings'

const UP = '#26a69a'
const DOWN = '#ef5350'
const GRID = '#1e222d'
const BORDER = '#2a2e39'
const LINE_COLOR = '#ffd54f'
const GRAB_PX = 6

const overlay = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const

/** Draws the measured ranges on the price pane. It reports no autoscale info, so it never changes the price scale. */
class RangesPrimitive implements ISeriesPrimitive<Time> {
  private ranges: RangePoints[] = []
  private param: SeriesAttachedParameter<Time> | null = null
  private readonly views: IPrimitivePaneView[] = [
    {
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width)),
      }),
    },
  ]

  constructor(private readonly precision: number) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.param = param
  }

  detached() {
    this.param = null
  }

  paneViews() {
    return this.views
  }

  /** The dates must be times of candles on the chart. */
  setRanges(ranges: RangePoints[]) {
    this.ranges = ranges
    this.param?.requestUpdate()
  }

  private draw(ctx: CanvasRenderingContext2D, width: number) {
    if (!this.param) return
    const { chart, series } = this.param
    const timeScale = chart.timeScale()
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const r of this.ranges) {
      const x1 = timeScale.timeToCoordinate(r.fromDate)
      const x2 = timeScale.timeToCoordinate(r.toDate)
      const y1 = series.priceToCoordinate(r.fromPrice)
      const y2 = series.priceToCoordinate(r.toPrice)
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue
      const left = Math.max(Math.min(x1, x2), 0)
      const right = Math.min(Math.max(x1, x2), width)
      if (left > right) continue

      const up = r.toPrice >= r.fromPrice
      const color = up ? UP : DOWN
      ctx.fillStyle = `${color}33`
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
      ctx.strokeStyle = color
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

      // The label sits just outside the end-price edge, centred on the visible part of the rectangle.
      const text = formatRange(r.fromPrice, r.toPrice, this.precision)
      const w = ctx.measureText(text).width + 12
      const x = Math.min(Math.max((left + right) / 2, w / 2), width - w / 2)
      const y = y2 + (up ? -12 : 12)
      ctx.fillStyle = color
      ctx.fillRect(x - w / 2, y - 9, w, 18)
      ctx.fillStyle = '#fff'
      ctx.fillText(text, x, y)
    }
  }
}

type ChartApi = {
  chart: IChartApi
  series: ISeriesApi<'Candlestick'>
  priceLines: Map<number, IPriceLine>
  ranges: RangesPrimitive
  /** Re-plots every series from the candle at time `from` on; that one must be the last candle plotted so far. */
  update: (candles: Candle[], from: string) => void
}

function build(el: HTMLElement, candles: Candle[], s: IndicatorSettings): ChartApi {
  const chart = createChart(el, {
    autoSize: true,
    layout: { background: { color: '#131722' }, textColor: '#b2b5be', panes: { separatorColor: BORDER } },
    grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
    rightPriceScale: { borderColor: BORDER },
    timeScale: { borderColor: BORDER },
  })

  const precision = pricePrecision(candles.at(-1)?.close ?? 1)
  const series = chart.addSeries(CandlestickSeries, {
    upColor: UP,
    downColor: DOWN,
    borderVisible: false,
    wickUpColor: UP,
    wickDownColor: DOWN,
    priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
  })
  const plots: ((current: Candle[], from?: string) => void)[] = []
  function plot<T extends SeriesType>(
    target: ISeriesApi<T>,
    data: (cs: Candle[]) => (SeriesDataItemTypeMap[T] & { time: string })[],
  ) {
    const apply = (current: Candle[], from?: string) => {
      const points = data(current)
      if (from === undefined) target.setData(points)
      // update() rewrites the `time` of the object it is given, so it gets a copy.
      else for (const point of points) if (point.time >= from) target.update({ ...point })
    }
    apply(candles)
    plots.push(apply)
  }

  plot(series, (cs) => cs)
  const ranges = new RangesPrimitive(precision)
  series.attachPrimitive(ranges)

  if (s.volume.enabled) {
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: '',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    plot(volume, (cs) =>
      cs.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? `${UP}80` : `${DOWN}80` })),
    )
  }

  s.movingAverages.forEach((ma, i) => {
    if (!ma.enabled) return
    const average = ma.type === 'SMA' ? sma : ema
    plot(chart.addSeries(LineSeries, { ...overlay, color: maColor(i) }), (cs) => average(cs, ma.period))
  })

  if (s.bollinger.enabled) {
    for (const key of ['upper', 'middle', 'lower'] as const) {
      plot(
        chart.addSeries(LineSeries, { ...overlay, color: '#78909c', lineStyle: key === 'middle' ? LineStyle.Dashed : LineStyle.Solid }),
        (cs) => bollinger(cs, s.bollinger.period, s.bollinger.stdDev).map((b) => ({ time: b.time, value: b[key] })),
      )
    }
  }

  let pane = 0
  if (s.rsi.enabled) {
    pane += 1
    const line = chart.addSeries(LineSeries, { ...overlay, lastValueVisible: true, color: '#ab47bc' }, pane)
    plot(line, (cs) => rsi(cs, s.rsi.period))
    for (const price of [70, 30]) {
      line.createPriceLine({ price, color: '#5d606b', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
    }
  }

  if (s.macd.enabled) {
    pane += 1
    const data = (cs: Candle[]) => macd(cs, s.macd.fast, s.macd.slow, s.macd.signal)
    plot(chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane), (cs) =>
      data(cs).map((d) => ({ time: d.time, value: d.histogram, color: d.histogram >= 0 ? `${UP}80` : `${DOWN}80` })),
    )
    plot(chart.addSeries(LineSeries, { ...overlay, color: '#42a5f5' }, pane), (cs) =>
      data(cs).map((d) => ({ time: d.time, value: d.macd })),
    )
    plot(chart.addSeries(LineSeries, { ...overlay, color: '#ff7043' }, pane), (cs) =>
      data(cs).map((d) => ({ time: d.time, value: d.signal })),
    )
  }

  chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1))
  const update = (current: Candle[], from: string) => plots.forEach((apply) => apply(current, from))
  return { chart, series, priceLines: new Map(), ranges, update }
}

type Props = {
  candles: Candle[]
  settings: IndicatorSettings
  lines: Line[]
  ranges: Range[]
  mode: 'line' | 'measure' | null
  onAddLine: (price: number) => void
  onMoveLine: (id: number, price: number) => void
  onAddRange: (range: RangePoints) => void
}

export function PriceChart({ candles, settings, lines, ranges, mode, onAddLine, onMoveLine, onAddRange }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ChartApi | null>(null)
  const range = useRef<LogicalRange | null>(null)
  const shown = useRef<{ candles: Candle[]; settings: IndicatorSettings } | null>(null)
  const drag = useRef<{ id: number; line: IPriceLine; moved: boolean } | null>(null)
  const placing = useRef<{ x: number; y: number } | null>(null)
  const measureStart = useRef<{ x: number; y: number; at: number } | null>(null)
  const [version, setVersion] = useState(0)
  // The measurement being placed: fixed start, end following the pointer.
  const [draft, setDraft] = useState<RangePoints | null>(null)

  // A refresh of the running candle is drawn in place, so it cannot disturb a drag or a measurement. Any other
  // change of data or settings rebuilds the chart; the zoom/scroll position is carried over.
  useEffect(() => {
    const prev = shown.current
    shown.current = { candles, settings }
    const current = apiRef.current
    if (current && prev) {
      const inPlace =
        prev.settings === settings &&
        onlyTailChanged(prev.candles, candles) &&
        pricePrecision(prev.candles.at(-1)!.close) === pricePrecision(candles.at(-1)!.close)
      if (inPlace) return current.update(candles, prev.candles.at(-1)!.time)
      range.current = current.chart.timeScale().getVisibleLogicalRange()
      current.chart.remove()
    }
    const api = build(el.current!, candles, settings)
    if (range.current) api.chart.timeScale().setVisibleLogicalRange(range.current)
    apiRef.current = api
    setVersion((v) => v + 1)
  }, [candles, settings])

  useEffect(
    () => () => {
      apiRef.current?.chart.remove()
      apiRef.current = null
    },
    [],
  )

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    for (const [id, priceLine] of api.priceLines) {
      if (lines.some((l) => l.id === id)) continue
      api.series.removePriceLine(priceLine)
      api.priceLines.delete(id)
    }
    for (const { id, price } of lines) {
      const existing = api.priceLines.get(id)
      if (existing) existing.applyOptions({ price })
      else api.priceLines.set(id, api.series.createPriceLine({ price, color: LINE_COLOR, lineWidth: 2, lineStyle: LineStyle.Solid }))
    }
  }, [version, lines])

  useEffect(() => {
    if (mode !== 'measure') setDraft(null)
  }, [mode])

  useEffect(() => {
    const shown = draft ? [...ranges, draft] : ranges
    apiRef.current?.ranges.setRanges(
      shown.map((r) => ({ ...r, fromDate: candleTime(candles, r.fromDate), toDate: candleTime(candles, r.toDate) })),
    )
  }, [version, candles, ranges, draft])

  // The price pane is the top-left of the chart element, so element-relative y is pane-relative y.
  const paneY = (e: PointerEvent) => e.clientY - el.current!.getBoundingClientRect().top

  const inPricePane = (e: PointerEvent) => {
    const size = apiRef.current!.chart.paneSize(0)
    return paneY(e) <= size.height && e.clientX - el.current!.getBoundingClientRect().left <= size.width
  }

  const lineAt = (e: PointerEvent) => {
    const api = apiRef.current
    if (!api || !inPricePane(e)) return null
    const y = paneY(e)
    for (const [id, line] of api.priceLines) {
      const lineY = api.series.priceToCoordinate(line.options().price)
      if (lineY !== null && Math.abs(lineY - y) <= GRAB_PX) return { id, line }
    }
    return null
  }

  /** The price under the pointer and the date of the candle under it, clamped to the first/last candle. */
  const pointAt = (e: PointerEvent) => {
    const api = apiRef.current!
    const price = api.series.coordinateToPrice(paneY(e))
    const index = api.chart.timeScale().coordinateToLogical(e.clientX - el.current!.getBoundingClientRect().left)
    if (price === null || price <= 0 || index === null) return null
    return { date: candles[Math.min(Math.max(Math.round(index), 0), candles.length - 1)].time, price }
  }

  const onPointerDown = (e: PointerEvent) => {
    // Placement is detected here rather than with the chart's click event, which drops a click that follows
    // another one within its double-click window.
    placing.current = mode ? { x: e.clientX, y: e.clientY } : null
    const hit = mode ? null : lineAt(e)
    if (!hit) return
    drag.current = { ...hit, moved: false }
    el.current!.setPointerCapture(e.pointerId)
    // Otherwise the chart would pan along with the drag.
    apiRef.current!.chart.applyOptions({ handleScroll: false, handleScale: false })
  }

  const onPointerMove = (e: PointerEvent) => {
    const api = apiRef.current
    if (!api) return
    if (!drag.current) {
      el.current!.classList.toggle('over-line', !mode && lineAt(e) !== null)
      const end = draft && pointAt(e)
      if (end) setDraft({ ...draft, toDate: end.date, toPrice: end.price })
      return
    }
    const price = api.series.coordinateToPrice(paneY(e))
    if (price === null || price <= 0) return
    drag.current.line.applyOptions({ price })
    drag.current.moved = true
  }

  const onPointerUp = (e: PointerEvent) => {
    const down = placing.current
    placing.current = null
    const api = apiRef.current
    if (down && api && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && inPricePane(e)) {
      if (mode === 'line') {
        const price = api.series.coordinateToPrice(paneY(e))
        if (price !== null && price > 0) onAddLine(price)
      } else {
        const point = pointAt(e)
        if (point && draft) {
          // A double-click on the start point would otherwise save an empty measurement.
          const start = measureStart.current
          const doubleClick = start && e.timeStamp - start.at < 500 && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5
          if (!doubleClick) {
            onAddRange({ ...draft, toDate: point.date, toPrice: point.price })
          }
        } else if (point) {
          measureStart.current = { x: e.clientX, y: e.clientY, at: e.timeStamp }
          setDraft({ fromDate: point.date, fromPrice: point.price, toDate: point.date, toPrice: point.price })
        }
      }
    }
    const dragged = drag.current
    if (!dragged) return
    drag.current = null
    apiRef.current?.chart.applyOptions({ handleScroll: true, handleScale: true })
    if (dragged.moved) onMoveLine(dragged.id, dragged.line.options().price)
  }

  return (
    <div
      ref={el}
      className={`chart${mode === 'line' ? ' adding' : ''}${mode === 'measure' ? ' measuring' : ''}`}
      onPointerDownCapture={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
