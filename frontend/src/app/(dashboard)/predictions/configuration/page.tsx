import type { Metadata } from "next"
import { Cpu } from "lucide-react"

export const metadata: Metadata = { title: "Prediction Configuration" }

export default function PredictionConfigurationPage() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
      <Cpu className="h-8 w-8 opacity-30" />
      <p className="text-sm">Prediction configuration coming soon</p>
    </div>
  )
}
