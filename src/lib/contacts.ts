import type { Contact } from "@/domain/types"

export interface ContactLink {
  label: string
  href: string
}

const digits = (phone: string) => phone.replace(/[^\d+]/g, "")

/** Ways to reach a contact in other apps, based on the details they have. */
export function contactLinks(c: Contact): ContactLink[] {
  const links: ContactLink[] = []
  if (c.phone) {
    links.push({ label: "Messages", href: `sms:${digits(c.phone)}` })
    links.push({ label: "Call", href: `tel:${digits(c.phone)}` })
  }
  if (c.email) links.push({ label: "Email", href: `mailto:${c.email}` })
  if (c.telegram) links.push({ label: "Telegram", href: `https://t.me/${c.telegram.replace(/^@/, "")}` })
  if (c.signal) {
    // Signal links only open chats by phone number; usernames have to be searched in the app.
    const phone = digits(c.signal)
    if (/^\+?\d{6,}$/.test(phone)) links.push({ label: "Signal", href: `https://signal.me/#p/${phone.startsWith("+") ? phone : `+${phone}`}` })
  }
  if (c.discordId) links.push({ label: "Discord", href: `https://discord.com/users/${c.discordId}` })
  return links
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  )
}
