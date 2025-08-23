// src/app.jsx
import { Link } from "react-router-dom"
import AppRouter from "./router"
import Header from "./components/shared/header"
export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* header / nav */}
      <Header />

      {/* page content */}
      <main className="flex-1 p-6">
        <AppRouter />
      </main>

      {/* footer */}
      <footer className="border-t p-4 text-xs text-muted-foreground">
        react + vite + shadcn/ui
      </footer>
    </div>
  )
}
