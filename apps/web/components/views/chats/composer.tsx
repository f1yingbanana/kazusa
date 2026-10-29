'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUpIcon, HandIcon, MessageCircleIcon } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import type { MessageType } from '@/lib/source/chats/types'
import { cn } from '@/lib/utils'
import { ModelPicker } from './model-picker'
import { ThinkingPicker } from './thinking-picker'

const MODES = [
  { type: 'speech', label: 'Say', icon: MessageCircleIcon },
  { type: 'action', label: 'Do', icon: HandIcon },
] as const

/**
 * Face to face (`canAct`), the player can also do something instead of saying
 * it. An action is written like the characters write theirs: third person,
 * without the subject ("waves"), and narrated with the player's name.
 */
export function Composer({
  placeholder,
  onSend,
  onTyping,
  disabled,
  canAct,
}: {
  placeholder: string
  onSend: (text: string, type: MessageType) => void
  onTyping: (isTyping: boolean) => void
  disabled?: boolean
  canAct?: boolean
}) {
  const [text, setText] = useState('')
  const [type, setType] = useState<MessageType>('speech')
  const acting = canAct && type === 'action'
  const lastTyping = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(idleTimer.current); onTyping(false) }, [onTyping])
  function stopTyping() {
    clearTimeout(idleTimer.current)
    lastTyping.current = 0
    onTyping(false)
  }
  function typing(value: string) {
    setText(value)
    if (!value.trim()) { stopTyping(); return }
    if (Date.now() - lastTyping.current >= 3000) {
      lastTyping.current = Date.now()
      onTyping(true)
    }
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(stopTyping, 4000)
  }
  const canSend = text.trim().length > 0 && !disabled

  function submit() {
    if (!canSend) return
    stopTyping()
    onSend(text.trim(), acting ? 'action' : 'speech')
    setText('')
  }

  return (
    <form
      className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <InputGroup className="rounded-2xl bg-background shadow-xs">
        <InputGroupTextarea
          value={text}
          onChange={(event) => typing(event.target.value)}
          onBlur={stopTyping}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={acting ? 'What do you do? Write it without your name: “waves”' : placeholder}
          aria-label={acting ? 'Action' : 'Message'}
          rows={1}
          className={cn('max-h-48 min-h-12 px-4 pt-3', acting && 'italic')}
        />
        <InputGroupAddon align="block-end" className="pb-2.5">
          {canAct ? (
            <div role="radiogroup" aria-label="Say or do" className="flex rounded-full bg-muted p-0.5">
              {MODES.map((mode) => (
                <button
                  key={mode.type}
                  type="button"
                  role="radio"
                  aria-checked={type === mode.type}
                  onClick={() => setType(mode.type)}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                    type === mode.type && 'bg-background text-foreground shadow-xs',
                  )}
                >
                  <mode.icon aria-hidden className="size-3.5" />
                  {mode.label}
                </button>
              ))}
            </div>
          ) : null}
          <InputGroupText className="hidden gap-1 text-xs xl:flex">
            <Kbd>Enter</Kbd> to send
            <span aria-hidden className="px-1">
              ·
            </span>
            <Kbd>Shift</Kbd>
            <span aria-hidden>+</span>
            <Kbd>Enter</Kbd> new line
          </InputGroupText>
          {/* The model and reasoning level are the world's, not this chat's. */}
          <div className="ml-auto flex min-w-0 items-center gap-0.5">
            <ModelPicker />
            <ThinkingPicker />
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="ml-1 rounded-full"
              disabled={!canSend}
            >
              <ArrowUpIcon />
              <span className="sr-only">Send message</span>
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
