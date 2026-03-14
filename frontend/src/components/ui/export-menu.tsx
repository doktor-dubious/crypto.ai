"use client"

import { Download, FileSpreadsheet, FileText, Copy, FileJson, FileDown } from "lucide-react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  exportToJSON,
  copyToClipboard,
  type ExportColumn,
} from "@/lib/export"

interface ExportMenuProps {
  data: any[]
  columns: ExportColumn[]
  filename: string
}

export function ExportMenu({ data, columns, filename }: ExportMenuProps) {
  const t = useTranslations("export")

  const handleExport = async (format: string) => {
    try {
      switch (format) {
        case "csv":
          exportToCSV(data, columns, filename)
          toast.success(t("csvSuccess"))
          break
        case "excel":
          exportToExcel(data, columns, filename)
          toast.success(t("excelSuccess"))
          break
        case "pdf":
          await exportToPDF(data, columns, filename)
          toast.success(t("pdfSuccess"))
          break
        case "json":
          exportToJSON(data, filename)
          toast.success(t("jsonSuccess"))
          break
        case "clipboard":
          await copyToClipboard(data, columns)
          toast.success(t("clipboardSuccess"))
          break
      }
    } catch (err) {
      console.error("Export error:", err)
      toast.error(t("exportError"))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0 cursor-pointer">
          <Download className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("csv")} className="cursor-pointer text-xs">
          <FileDown className="mr-2 h-3.5 w-3.5" />
          {t("csv")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("excel")} className="cursor-pointer text-xs">
          <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
          {t("excel")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("pdf")} className="cursor-pointer text-xs">
          <FileText className="mr-2 h-3.5 w-3.5" />
          {t("pdf")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("json")} className="cursor-pointer text-xs">
          <FileJson className="mr-2 h-3.5 w-3.5" />
          {t("json")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("clipboard")} className="cursor-pointer text-xs">
          <Copy className="mr-2 h-3.5 w-3.5" />
          {t("clipboard")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
