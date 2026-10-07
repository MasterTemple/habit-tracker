import { BellRingIcon, EyeIcon, UsersIcon } from "lucide-react"

export function SocialPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Social</h1>
      <div className="flex flex-col gap-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <p>Coming once there’s a sync server. Planned:</p>
        <Feature icon={UsersIcon} title="Friends">
          Find and add people, set your relationship, and open Telegram, Signal, Discord, or Messages to contact them.
        </Feature>
        <Feature icon={EyeIcon} title="Sharing">
          Let chosen people view specific tasks or whole categories.
        </Feature>
        <Feature icon={BellRingIcon} title="Accountability">
          Notify chosen people when a task is completed, failed, or a deadline is missed.
        </Feature>
      </div>
    </div>
  )
}

function Feature({ icon: Icon, title, children }: { icon: typeof UsersIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <p>{children}</p>
      </div>
    </div>
  )
}
