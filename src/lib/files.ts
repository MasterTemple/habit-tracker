/** Saves JSON via the share sheet (most reliable on iOS), falling back to a download. */
export async function saveJson(name: string, data: unknown) {
  await saveFile(new File([JSON.stringify(data, null, 2)], name, { type: "application/json" }))
}

/** Saves a file via the share sheet when there is one, otherwise as a download. */
export async function saveFile(file: File) {
  const name = file.name
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      if ((e as Error).name === "AbortError") return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
