import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { BreakEditor, type BreakTarget } from "@/components/BreakEditor"
import { CategoryEditor, type CategoryTarget } from "@/components/CategoryEditor"
import { TaskEditor, type EditorTarget } from "@/components/TaskEditor"

interface Editors {
  openTask: (target: EditorTarget) => void
  openCategory: (target: CategoryTarget) => void
  openBreak: (target: BreakTarget) => void
}

const EditorsContext = createContext<Editors | null>(null)

/** Hosts the create/edit sheets once so any page (and the + menu) can open them. */
export function EditorsProvider({ children }: { children: ReactNode }) {
  const [task, setTask] = useState<EditorTarget | null>(null)
  const [category, setCategory] = useState<CategoryTarget | null>(null)
  const [breakTarget, setBreakTarget] = useState<BreakTarget | null>(null)

  const editors = useMemo<Editors>(
    () => ({ openTask: setTask, openCategory: setCategory, openBreak: setBreakTarget }),
    [],
  )

  return (
    <EditorsContext.Provider value={editors}>
      {children}
      <TaskEditor target={task} onClose={() => setTask(null)} />
      <CategoryEditor target={category} onClose={() => setCategory(null)} />
      <BreakEditor target={breakTarget} onClose={() => setBreakTarget(null)} />
    </EditorsContext.Provider>
  )
}

export function useEditors(): Editors {
  const value = useContext(EditorsContext)
  if (!value) throw new Error("useEditors must be used inside EditorsProvider")
  return value
}
