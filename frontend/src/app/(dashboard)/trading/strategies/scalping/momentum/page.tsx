import { redirect } from "next/navigation"

// The strategy landing route defaults to its Analytics view.
export default function Page() {
  redirect("/trading/strategies/scalping/momentum/analytics")
}
