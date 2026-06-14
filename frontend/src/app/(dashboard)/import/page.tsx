"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Upload, Download, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { coinsApi, binanceImportApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useQuery } from "@tanstack/react-query"

// A single running/finished background import, polling its own status.
function ImportJobRow({ taskId, name, onClear }: { taskId: string; name: string; onClear: () => void }) {
  const { data } = useQuery({
    queryKey: ["importStatus", taskId],
    queryFn: () => binanceImportApi.status(taskId),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === "success" || s === "failure" || s === "stopped" ? false : 2000
    },
  })
  const status = data?.status ?? "pending"
  const progress = data?.progress ?? 0
  const done = status === "success" || status === "failure" || status === "stopped"
  const barColor = status === "failure" ? "bg-red-500" : status === "success" ? "bg-green-500" : "bg-blue-500"

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium font-mono truncate">{name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {status === "success" && data?.imported_count != null && (
            <span className="text-xs text-green-600 dark:text-green-400">{data.imported_count.toLocaleString()} klines</span>
          )}
          {status === "failure" && <span className="text-xs text-red-500">failed</span>}
          {!done && <span className="text-xs text-muted-foreground">{progress}%</span>}
          {done && (
            <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground truncate mt-0.5">{data?.error ?? data?.progress_message ?? "Queued…"}</p>
      {!done && (
        <div className="h-1.5 w-full rounded-full bg-muted mt-2">
          <div className={`h-1.5 rounded-full ${barColor} transition-all duration-500`} style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}

export default function ImportPage() {
  const t = useTranslations("import")
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState("")
  const [imports, setImports] = useState<{ taskId: string; name: string }[]>([])

  // Fetch coins for dropdown
  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: async () => {
      const response = await coinsApi.list({ limit: 1000 })
      return response
    },
  })

  const [selectedCoin, setSelectedCoin] = useState("")
  const [selectedInterval, setSelectedInterval] = useState("1h")
  const [selectedQuoteAsset, setSelectedQuoteAsset] = useState("USDT")
  const [binanceUrl, setBinanceUrl] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [file, setFile] = useState<File | null>(null)

  const intervals = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"]
  const quoteAssets = ["USDT", "USD", "USDC", "BUSD", "TUSD"]

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !selectedCoin) {
      toast.error("Please select a file and a coin")
      return
    }

    setLoading(true)
    setProgress("Uploading file...")

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("coin_id", selectedCoin)
      formData.append("interval", selectedInterval)
      formData.append("quote_asset", selectedQuoteAsset)

      const response = await fetch("/backend/api/v1/binance-import/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || "Upload failed")
      }

      const result = await response.json()
      toast.success(`Successfully imported ${result.imported_count} klines`)
      setFile(null)
      setProgress("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed")
    } finally {
      setLoading(false)
    }
  }

  const handleBinanceImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCoin || !selectedInterval) {
      toast.error("Please select a coin and interval")
      return
    }

    // Get the selected coin to build the symbol
    const coin = coins.find((c) => c.id === selectedCoin)
    if (!coin) {
      toast.error("Coin not found")
      return
    }

    // Construct symbol from coin symbol + quote asset (e.g., BTC + USDT = BTCUSDT)
    const symbol = coin.symbol + selectedQuoteAsset

    try {
      const { task_id, name } = await binanceImportApi.startAsync({
        symbol,
        interval: selectedInterval,
        coin_id: selectedCoin,
        quote_asset: selectedQuoteAsset,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      })
      // Runs in the background — add it to the list and let it poll. The user
      // can immediately start another import.
      setImports((prev) => [{ taskId: task_id, name }, ...prev])
      toast.success(`Import started: ${name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start import")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Import Binance Kline Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import historical OHLCV data from Binance into the klines table
        </p>
      </div>

      {imports.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Imports</h2>
          {imports.map((job) => (
            <ImportJobRow
              key={job.taskId}
              taskId={job.taskId}
              name={job.name}
              onClear={() => setImports((prev) => prev.filter((j) => j.taskId !== job.taskId))}
            />
          ))}
        </div>
      )}

      <Tabs defaultValue="upload" className="w-full">
        <TabsList>
          <TabsTrigger value="upload">
            <Upload className="h-4 w-4 mr-2" />
            Upload File
          </TabsTrigger>
          <TabsTrigger value="binance">
            <Download className="h-4 w-4 mr-2" />
            Binance Direct
          </TabsTrigger>
        </TabsList>

        {/* Upload Tab */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV/ZIP File</CardTitle>
              <CardDescription>
                Upload a file from Binance or your local directory. Supports CSV, ZIP, and GZ formats.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleFileUpload} className="space-y-4">
                {/* Coin Selection */}
                <div>
                  <label className="text-sm font-medium">Select Coin</label>
                  <select
                    value={selectedCoin}
                    onChange={(e) => setSelectedCoin(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                  >
                    <option value="">Choose a coin...</option>
                    {coins.map((coin) => (
                      <option key={coin.id} value={coin.id}>
                        {coin.name} ({coin.id.slice(0, 8)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Interval Selection */}
                <div>
                  <label className="text-sm font-medium">Select Interval</label>
                  <select
                    value={selectedInterval}
                    onChange={(e) => setSelectedInterval(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                  >
                    {intervals.map((interval) => (
                      <option key={interval} value={interval}>
                        {interval}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quote Asset Selection */}
                <div>
                  <label className="text-sm font-medium">Quote Asset</label>
                  <select
                    value={selectedQuoteAsset}
                    onChange={(e) => setSelectedQuoteAsset(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                  >
                    {quoteAssets.map((asset) => (
                      <option key={asset} value={asset}>
                        {asset}
                      </option>
                    ))}
                  </select>
                </div>

                {/* File Upload */}
                <div>
                  <label className="text-sm font-medium">Select File</label>
                  <input
                    type="file"
                    accept=".csv,.zip,.gz"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Accepted formats: CSV, ZIP (containing CSV), GZ
                  </p>
                </div>

                {progress && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-md text-sm text-blue-900 dark:text-blue-100">
                    {progress}
                  </div>
                )}

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Uploading..." : "Upload and Import"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Binance Direct Tab */}
        <TabsContent value="binance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Import from Binance</CardTitle>
              <CardDescription>
                Download kline data directly from Binance Data Vision
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleBinanceImport} className="space-y-4">
                {/* Coin Selection */}
                <div>
                  <label className="text-sm font-medium">Select Coin</label>
                  <select
                    value={selectedCoin}
                    onChange={(e) => setSelectedCoin(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                  >
                    <option value="">Choose a coin...</option>
                    {coins.map((coin) => (
                      <option key={coin.id} value={coin.id}>
                        {coin.name} ({coin.id.slice(0, 8)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Symbol Info */}
                <div className="p-3 bg-amber-50 dark:bg-amber-950 rounded-md flex gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-900 dark:text-amber-100 shrink-0 mt-0.5" />
                  <div className="text-amber-900 dark:text-amber-100">
                    <p className="font-medium">Note:</p>
                    <p>Symbol is automatically detected from the coin's Binance symbol (e.g., BTCUSDT, ETHUSDT)</p>
                  </div>
                </div>

                {/* Interval Selection */}
                <div>
                  <label className="text-sm font-medium">Select Interval</label>
                  <select
                    value={selectedInterval}
                    onChange={(e) => setSelectedInterval(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                  >
                    {intervals.map((interval) => (
                      <option key={interval} value={interval}>
                        {interval}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quote Asset Selection */}
                <div>
                  <label className="text-sm font-medium">Quote Asset</label>
                  <select
                    value={selectedQuoteAsset}
                    onChange={(e) => setSelectedQuoteAsset(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                  >
                    {quoteAssets.map((asset) => (
                      <option key={asset} value={asset}>
                        {asset}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm font-medium">Start Date</label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Optional: defaults to last 30 days</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">End Date</label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full">
                  Start Import from Binance
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Runs in the background — you can start several at once and track them above.
                </p>
              </form>
            </CardContent>
          </Card>

          {/* Info Box */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Binance Data Source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Data is sourced from:{" "}
                <a
                  href="https://data.binance.vision/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  https://data.binance.vision/
                </a>
              </p>
              <p className="text-muted-foreground">
                Kline data is available for daily intervals. The import process will download from Binance and store in
                the klines table.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
