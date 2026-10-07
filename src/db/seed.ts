import { COLORS } from "@/lib/icons"
import { createCategory, createTask, type TaskInput } from "./repo"

const base: Omit<TaskInput, "name" | "type" | "icon" | "color" | "period" | "amount"> = {
  description: "",
  unit: "",
  dueTime: null,
  incrementAmounts: [1],
  displayMode: "period",
  carryOver: false,
  categoryIds: [],
}

/** The examples from the original design notes, for trying the app out. */
export async function seedExamples() {
  const exercise = await createCategory("Exercise", COLORS[0], "dumbbell")
  const spiritual = await createCategory("Spiritual", COLORS[6], "book-open")
  const health = await createCategory("Health", COLORS[3], "heart")

  await createTask({ ...base, name: "Daily Proverb", type: "accumulate", icon: "book-open", color: COLORS[6], dueTime: "09:00", period: "day", amount: 1, categoryIds: [spiritual] })
  await createTask({ ...base, name: "Pull-ups", type: "accumulate", icon: "dumbbell", color: COLORS[0], unit: "rep", period: "day", amount: 100, incrementAmounts: [1, 5, 10], categoryIds: [exercise] })
  await createTask({ ...base, name: "Watch YouTube", type: "limit", icon: "monitor-play", color: COLORS[9], period: "day", amount: 0 })
  await createTask({ ...base, name: "Run", type: "accumulate", icon: "footprints", color: COLORS[1], period: "week", amount: 3, categoryIds: [exercise] })
  await createTask({ ...base, name: "Eat ice cream", type: "limit", icon: "ice-cream-cone", color: COLORS[8], period: "week", amount: 3, carryOver: true, categoryIds: [health] })
  await createTask({ ...base, name: "Ate breakfast", type: "track", icon: "utensils", color: COLORS[2], period: "day", amount: 1, categoryIds: [health] })
}
