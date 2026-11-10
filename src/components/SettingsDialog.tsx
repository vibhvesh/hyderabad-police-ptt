import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  name: string
  onName: (value: string) => void
}

export function SettingsDialog({ name, onName }: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Settings">
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Your unit name is only a label on this line. Speech recognition and translation are set in the control room.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="unit-name">Unit name</Label>
          <Input id="unit-name" value={name} maxLength={40} autoComplete="off" onChange={(event) => onName(event.target.value)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
