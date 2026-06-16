import { redirect } from "next/navigation"

export default function SimulationsIndexPage() {
  redirect("/simulations/completed")
}
