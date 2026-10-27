'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUpIcon } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'

export function Composer({
  placeholder,
  onSend,
  onTyping,
  disabled,
}: {
  placeholder: string
  onSend: (text: string) => void
  onTyping: (isTyping: boolean) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')
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
    onSend(text.trim())
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
          placeholder={placeholder}
          aria-label="Message"
          rows={1}
          className="max-h-48 min-h-12 px-4 pt-3"
        />
        <InputGroupAddon align="block-end" className="pb-2.5">
          <InputGroupText className="hidden gap-1 text-xs sm:flex">
            <Kbd>Enter</Kbd> to send
            <span aria-hidden className="px-1">
              ·
            </span>
            <Kbd>Shift</Kbd>
            <span aria-hidden>+</span>
            <Kbd>Enter</Kbd> new line
          </InputGroupText>
          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            className="ml-auto rounded-full"
            disabled={!canSend}
          >
            <ArrowUpIcon />
            <span className="sr-only">Send message</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
