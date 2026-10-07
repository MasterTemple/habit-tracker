import { describe, expect, it } from "vitest"
import type { TaskView } from "@/hooks/useAppData"
import { ON_BREAK, RETIRED, UNCATEGORIZED, visibleTasks } from "./filters"

const TODAY = "2026-10-06"
const view = (id: string, opts: { retired?: boolean; onBreak?: boolean; categories?: string[] } = {}) =>
  ({
    task: { id, retiredAt: opts.retired ? "x" : null },
    categories: (opts.categories ?? []).map((c) => ({ id: c })),
    ctx: {
      exceptions: opts.onBreak ? [{ startDate: TODAY, endDate: TODAY }] : [],
    },
  }) as unknown as TaskView

const tasks = [
  view("plain"),
  view("exercise", { categories: ["ex"] }),
  view("old", { retired: true, categories: ["ex"] }),
  view("away", { onBreak: true }),
]
const ids = (list: TaskView[]) => list.map((t) => t.task.id)

describe("visibleTasks", () => {
  it("hides retired and on-break tasks by default", () => {
    expect(ids(visibleTasks(tasks, [], { retired: false, breaks: false }, TODAY))).toEqual(["plain", "exercise"])
  })

  it("shows them when asked", () => {
    expect(ids(visibleTasks(tasks, [], { retired: true, breaks: true }, TODAY))).toEqual(["plain", "exercise", "old", "away"])
  })

  it("filters by pseudo-categories, matching any", () => {
    const show = { retired: true, breaks: true }
    expect(ids(visibleTasks(tasks, [RETIRED], show, TODAY))).toEqual(["old"])
    expect(ids(visibleTasks(tasks, [ON_BREAK], show, TODAY))).toEqual(["away"])
    expect(ids(visibleTasks(tasks, [UNCATEGORIZED], show, TODAY))).toEqual(["plain", "away"])
    expect(ids(visibleTasks(tasks, ["ex", ON_BREAK], show, TODAY))).toEqual(["exercise", "old", "away"])
  })
})
