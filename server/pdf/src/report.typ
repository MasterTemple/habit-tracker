// Progress report. Data (data.json):
// {
//   title, window, generated: strings,
//   met, total: numbers (finished goals met / all finished goals),
//   tasks: [{ name, color: "#rrggbb", kind: "accumulate" | "limit" | "track", summary: string,
//             streak: number, period: "day" | "week" | "month",
//             bars: [{ label, actual, goal: number | none, state: "success" | "failure" | "open" | "excused" }] }]
// }
#let data = json("data.json")

#let ink = rgb("#18181b")
#let muted = rgb("#71717a")
#let faint = rgb("#e4e4e7")
#let green = rgb("#16a34a")
#let red = rgb("#dc2626")

#set document(title: data.title)
#set page(
  paper: "us-letter",
  margin: (x: 0.8in, y: 0.75in),
  footer: context [
    #set text(8pt, fill: muted)
    Habit Tracker · #data.generated
    #h(1fr)
    #counter(page).display("1 of 1", both: true)
  ],
)
#set text(font: "Libertinus Serif", size: 10.5pt, fill: ink)

// A bar per period, scaled to the largest amount or goal; the goal as a dashed tick over each bar.
#let chart(task) = {
  let bars = task.bars
  if bars.len() == 0 { return }
  let peak = calc.max(1, ..bars.map(b => calc.max(b.actual, if b.goal == none { 0 } else { b.goal })))
  let height = 0.75in
  let slot = 100% / bars.len()
  let color = rgb(task.color)
  block(width: 100%, height: height + 12pt, {
    for (i, b) in bars.enumerate() {
      let fill = if b.state == "failure" { muted.lighten(45%) } else if b.state == "excused" { faint } else if b.state == "open" { color.lighten(55%) } else { color }
      // A good period with nothing in it (e.g. a limit of 0 kept) still gets a sliver, so it doesn't read as a gap.
      let h = calc.max(height * calc.max(0, b.actual) / peak, if b.state == "success" { 1.5pt } else { 0pt })
      place(bottom + left, dx: slot * i, dy: -12pt, box(width: slot, align(center + bottom, rect(width: 70%, height: h, fill: fill, radius: (top: 1.5pt)))))
      if b.goal != none {
        place(bottom + left, dx: slot * i, dy: -12pt - height * b.goal / peak, line(length: slot, stroke: (paint: muted, thickness: 0.6pt, dash: "dashed")))
      }
      // Labels on the first, last, and every few bars in between, so they don't collide.
      let every = calc.max(1, calc.ceil(bars.len() / 7))
      if calc.rem(i, every) == 0 or i == bars.len() - 1 {
        place(bottom + left, dx: slot * i, box(width: slot, align(center, text(7pt, fill: muted, b.label))))
      }
    }
    place(bottom + left, dy: -12pt, line(length: 100%, stroke: 0.4pt + faint))
  })
}

#text(20pt, weight: "bold", data.title)
#v(-6pt)
#text(11pt, fill: muted, data.window)

#if data.total > 0 {
  let rate = calc.round(data.met / data.total * 100)
  v(4pt)
  grid(
    columns: (auto, 1fr),
    column-gutter: 14pt,
    align: horizon,
    text(28pt, weight: "bold", fill: if rate >= 70 { green } else if rate >= 40 { ink } else { red }, [#rate%]),
    [
      of goals met \
      #text(fill: muted)[#data.met of #data.total finished goals in this report]
    ],
  )
}

#v(6pt)
#line(length: 100%, stroke: 0.5pt + faint)

#if data.tasks.len() == 0 [
  #text(fill: muted)[No tasks in this report.]
]

#for task in data.tasks {
  block(breakable: false, above: 14pt, {
    grid(
      columns: (auto, 1fr, auto),
      column-gutter: 6pt,
      align: horizon,
      circle(radius: 4pt, fill: rgb(task.color)),
      text(12pt, weight: "bold", task.name),
      if task.streak >= 2 { text(9pt, fill: muted)[#(task.streak)-#(task.period) streak] },
    )
    v(-4pt)
    text(9.5pt, fill: muted, task.summary)
    v(2pt)
    chart(task)
  })
}
