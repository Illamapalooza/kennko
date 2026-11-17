import { BackspaceIcon } from './Icons.tsx'

type Props = {
  onKey: (key: string) => void
  onBackspace: () => void
  /** Shown bottom-left: "." for money, "00" for quick thousands, or nothing for a PIN. */
  extra?: '.' | '00' | null
}

export function Keypad({ onKey, onBackspace, extra = null }: Props) {
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
        <button type="button" key={k} onClick={() => onKey(k)}>{k}</button>
      ))}
      {extra ? <button type="button" onClick={() => onKey(extra)}>{extra}</button> : <span />}
      <button type="button" onClick={() => onKey('0')}>0</button>
      <button type="button" onClick={onBackspace} aria-label="Delete"><BackspaceIcon /></button>
    </div>
  )
}
