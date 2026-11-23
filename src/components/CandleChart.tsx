// ─── Candlestick chart with EMA 9/21/50 overlays (TradingView lightweight-charts) ───
import { useEffect, useMemo, useRef } from 'react';
import {
  createChart, ColorType, CrosshairMode,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import { ema } from '../lib/indicators';
import type { Candle } from '../lib/types';

interface Props {
  candles: Candle[];
  height?: number;
}

export default function CandleChart({ candles, height = 380 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaTrendRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Create chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        // transparent background — panel gradient shows through
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8194b8',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      grid: {
        vertLines: { color: 'rgba(140,170,255,0.055)' },
        horzLines: { color: 'rgba(140,170,255,0.055)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(34,211,238,0.35)', labelBackgroundColor: '#164e63' },
        horzLine: { color: 'rgba(34,211,238,0.35)', labelBackgroundColor: '#164e63' },
      },
      rightPriceScale: {
        borderColor: 'rgba(140,170,255,0.14)',
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(140,170,255,0.14)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      localization: { locale: 'en-GB' },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#2dd4a7',
      downColor: '#fb7185',
      wickUpColor: '#2dd4a7',
      wickDownColor: '#fb7185',
      borderVisible: false,
      priceLineVisible: true,
      priceLineColor: 'rgba(34,211,238,0.5)',
    });

    const mkLine = (color: string, width: 1 | 2): ISeriesApi<'Line'> =>
      chart.addLineSeries({
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaFastRef.current = mkLine('#22d3ee', 2);
    emaSlowRef.current = mkLine('#fbbf24', 2);
    emaTrendRef.current = mkLine('#a78bfa', 1);

    const ro = new ResizeObserver(entries => {
      const { width, height: h } = entries[0].contentRect;
      chart.resize(Math.max(80, Math.floor(width)), Math.max(120, Math.floor(h)));
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  const overlays = useMemo(() => {
    if (candles.length === 0) return null;
    const closes = candles.map(c => c.close);
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    const e50 = ema(closes, 50);
    const toLine = (arr: number[]) =>
      candles.map((c, i) => ({ time: c.time as UTCTimestamp, value: arr[i] }));
    return { e9: toLine(e9), e21: toLine(e21), e50: toLine(e50) };
  }, [candles]);

  // Push data on every update
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;
    candleSeriesRef.current.setData(
      candles.map(c => ({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      })),
    );
    if (overlays) {
      emaFastRef.current?.setData(overlays.e9);
      emaSlowRef.current?.setData(overlays.e21);
      emaTrendRef.current?.setData(overlays.e50);
    }
  }, [candles, overlays]);

  return (
    <div className="chart-shell" style={{ height }}>
      <div ref={containerRef} className="chart-canvas" />
      <div className="chart-legend">
        <span className="legend-item"><i style={{ background: '#22d3ee' }} />EMA 9</span>
        <span className="legend-item"><i style={{ background: '#fbbf24' }} />EMA 21</span>
        <span className="legend-item"><i style={{ background: '#a78bfa' }} />EMA 50</span>
      </div>
    </div>
  );
}
